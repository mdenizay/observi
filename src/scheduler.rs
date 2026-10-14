use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use anyhow::Result;
use rusqlite::Connection;
use tokio::sync::{mpsc, watch};
use tokio::task::AbortHandle;

use crate::db::now_ms;
use crate::models::{self, Monitor};
use crate::state::{
    AppState, Beat, BeatEvent, BeatRecord, DOWN, Event, MonitorLive, PAUSED, PENDING, RECENT_BEATS, UP, status_str,
};
use crate::{check, notify};

/// One tokio task per active monitor.
#[derive(Default)]
pub struct Scheduler {
    tasks: Mutex<HashMap<i64, AbortHandle>>,
}

impl Scheduler {
    /// (Re)start the check loop for a monitor. `delay` staggers start-up.
    pub fn start(&self, state: &AppState, monitor: Monitor, delay: Duration) {
        let id = monitor.id;
        let st = state.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            run_loop(st, monitor).await;
        })
        .abort_handle();
        if let Some(old) = self.tasks.lock().unwrap_or_else(|e| e.into_inner()).insert(id, handle) {
            old.abort();
        }
    }

    pub fn stop(&self, id: i64) {
        if let Some(h) = self.tasks.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
            h.abort();
        }
    }
}

async fn run_loop(state: AppState, monitor: Monitor) {
    loop {
        let result = check::run(&state.clients, &monitor).await;
        let pending = record_result(&state, &monitor, &result);
        let secs = if pending { monitor.cfg.retry_interval } else { monitor.cfg.interval };
        tokio::time::sleep(Duration::from_secs(secs as u64)).await;
    }
}

/// Apply a check result to the monitor's state machine. Returns true when the
/// monitor is PENDING (so the caller should use the retry interval).
fn record_result(state: &AppState, monitor: &Monitor, result: &check::CheckResult) -> bool {
    let (ok, latency, message) = (result.ok, result.latency_ms, result.message.clone());
    let now = now_ms();
    let (beat, important, transition) = {
        let mut live = state.live.write().unwrap_or_else(|e| e.into_inner());
        let entry = live.entry(monitor.id).or_default();
        entry.cert_problem = result.cert_problem.map(str::to_string);
        let settled = settled_status(entry);
        let s = if ok {
            entry.retries = 0;
            UP
        } else if settled != Some(DOWN) && entry.retries < monitor.cfg.max_retries {
            entry.retries += 1;
            PENDING
        } else {
            DOWN
        };
        let changed = (s == UP || s == DOWN) && settled != Some(s);
        let first = entry.beats.iter().all(|b| b.s == PAUSED);
        let important = changed || (first && s != PENDING);
        let transition = if changed && (settled.is_some() || s == DOWN) {
            let down_for = if s == UP { entry.down_since.map(|t| now - t) } else { None };
            Some((s, down_for))
        } else {
            None
        };
        if s == DOWN && settled != Some(DOWN) {
            entry.down_since = Some(now);
        } else if s == UP {
            entry.down_since = None;
        }
        let beat = Beat { t: now, s, l: latency, m: Some(message) };
        entry.push(beat.clone());
        (beat, important, transition)
    };

    publish(state, monitor.id, beat.clone(), important);

    if let Some((s, down_for)) = transition {
        if s == UP {
            // Certificates are often renewed together with a fix: re-read soon.
            crate::cert::recheck_soon(state, monitor.id);
        }
        let st = state.clone();
        let m = monitor.clone();
        let msg = beat.m.clone().unwrap_or_default();
        tokio::spawn(async move {
            let kind = if s == UP { "up" } else { "down" };
            crate::activity::record(&st, kind, &m, Some(crate::activity::status_data(&msg, down_for))).await;
            notify::monitor_changed(&st, &m, s, &msg, down_for).await;
        });
    }
    beat.s == PENDING
}

/// The most recent UP/DOWN status, ignoring PENDING and PAUSED beats.
fn settled_status(live: &MonitorLive) -> Option<u8> {
    live.beats.iter().rev().map(|b| b.s).find(|s| *s == UP || *s == DOWN)
}

fn publish(state: &AppState, monitor_id: i64, beat: Beat, important: bool) {
    let _ = state.events.send(Event::Beat(BeatEvent {
        monitor_id,
        beat: beat.clone(),
        status: status_str(Some(beat.s)),
    }));
    if state.writer.try_send(BeatRecord { monitor_id, beat, important }).is_err() {
        tracing::warn!("heartbeat writer queue full, dropping beat");
    }
}

/// Record a PAUSED beat and stop the task.
pub fn pause(state: &AppState, id: i64) {
    state.scheduler.stop(id);
    let beat = Beat { t: now_ms(), s: PAUSED, l: None, m: Some("Paused".into()) };
    {
        let mut live = state.live.write().unwrap_or_else(|e| e.into_inner());
        let entry = live.entry(id).or_default();
        entry.retries = 0;
        entry.push(beat.clone());
    }
    publish(state, id, beat, true);
}

/// Load the recent beats of every monitor from the DB into memory.
pub fn load_live(c: &Connection) -> Result<HashMap<i64, MonitorLive>> {
    let mut out = HashMap::new();
    let ids: Vec<i64> = c
        .prepare("SELECT id FROM monitors")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut st = c.prepare("SELECT t, s, l, m FROM heartbeats WHERE monitor_id = ? ORDER BY t DESC LIMIT ?")?;
    let mut down_st = c.prepare(
        "SELECT t FROM heartbeats WHERE monitor_id = ? AND important = 1 AND s = 0 ORDER BY t DESC LIMIT 1",
    )?;
    for id in ids {
        let mut beats: Vec<Beat> = st
            .query_map(rusqlite::params![id, RECENT_BEATS as i64], |r| {
                Ok(Beat { t: r.get(0)?, s: r.get(1)?, l: r.get(2)?, m: r.get(3)? })
            })?
            .collect::<rusqlite::Result<_>>()?;
        beats.reverse();
        let mut live = MonitorLive::default();
        for b in beats {
            live.push(b);
        }
        if settled_status(&live) == Some(DOWN) {
            live.down_since = down_st.query_row([id], |r| r.get(0)).ok();
        }
        out.insert(id, live);
    }
    Ok(out)
}

/// Start all active monitors, spreading their first checks over a few seconds.
pub async fn start_all(state: &AppState) -> Result<()> {
    let monitors = state.db.call(|c| models::list_monitors(c)).await?;
    let active: Vec<_> = monitors.into_iter().filter(|m| m.active).collect();
    let n = active.len().max(1) as u64;
    for (i, m) in active.into_iter().enumerate() {
        // Spread over up to 15s so we don't fire every request at once.
        let delay = Duration::from_millis(i as u64 * 15_000 / n);
        state.scheduler.start(state, m, delay);
    }
    Ok(())
}

/// Batches heartbeats into one transaction every couple of seconds to keep
/// SD-card writes low. On shutdown it flushes what is queued and returns.
pub async fn writer(state: AppState, mut rx: mpsc::Receiver<BeatRecord>, mut shutdown: watch::Receiver<bool>) {
    let mut buf: Vec<BeatRecord> = Vec::with_capacity(256);
    loop {
        let mut stop = tokio::select! {
            n = rx.recv_many(&mut buf, 512) => n == 0,
            _ = shutdown.changed() => true,
        };
        if !stop {
            // Give other beats a moment to arrive so they land in the same transaction.
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                _ = shutdown.changed() => stop = true,
            }
        }
        while let Ok(r) = rx.try_recv() {
            buf.push(r);
        }
        if !buf.is_empty() {
            flush(&state, std::mem::take(&mut buf)).await;
        }
        if stop {
            break;
        }
    }
}

async fn flush(state: &AppState, batch: Vec<BeatRecord>) {
    let res = state
        .db
        .call(move |c| {
            let tx = c.transaction()?;
            {
                let mut st = tx.prepare_cached(
                    "INSERT OR REPLACE INTO heartbeats (monitor_id, t, s, l, m, important) VALUES (?,?,?,?,?,?)",
                )?;
                for r in &batch {
                    st.execute(rusqlite::params![r.monitor_id, r.beat.t, r.beat.s, r.beat.l, r.beat.m, r.important])?;
                }
            }
            tx.commit()?;
            Ok(())
        })
        .await;
    if let Err(e) = res {
        tracing::error!("heartbeat write failed: {e:#}");
    }
}

/// Periodically refresh cached 24h uptime and prune old heartbeats.
pub async fn maintenance(state: AppState, retention_days: i64) {
    let mut tick = tokio::time::interval(Duration::from_secs(60));
    let mut last_prune = 0i64;
    loop {
        tick.tick().await;
        let now = now_ms();
        let prune = now - last_prune > 6 * 3600 * 1000;
        if prune {
            last_prune = now;
        }
        let res = state
            .db
            .call(move |c| {
                let ids: Vec<i64> = c
                    .prepare_cached("SELECT id FROM monitors")?
                    .query_map([], |r| r.get(0))?
                    .collect::<rusqlite::Result<_>>()?;
                let since = now - 24 * 3600 * 1000;
                let mut out = std::collections::HashMap::new();
                for id in &ids {
                    if let Some(u) = uptime(c, *id, since)? {
                        out.insert(*id, u);
                    }
                }
                if prune {
                    let cutoff = now - retention_days * 24 * 3600 * 1000;
                    let mut del = c.prepare_cached("DELETE FROM heartbeats WHERE monitor_id = ? AND t < ?")?;
                    for id in &ids {
                        del.execute([*id, cutoff])?;
                    }
                    c.execute(
                        "DELETE FROM heartbeats WHERE monitor_id NOT IN (SELECT id FROM monitors)",
                        [],
                    )?;
                    crate::activity::prune(c, cutoff)?;
                    c.execute_batch("PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);")?;
                }
                Ok(out)
            })
            .await;
        match res {
            Ok(map) => *state.uptime24.write().unwrap_or_else(|e| e.into_inner()) = map,
            Err(e) => tracing::error!("maintenance failed: {e:#}"),
        }
    }
}

/// Uptime percentage over UP/DOWN beats since `since` (PENDING/PAUSED excluded).
pub fn uptime(c: &Connection, id: i64, since: i64) -> Result<Option<f64>> {
    let (up, total): (i64, i64) = c.prepare_cached(
        "SELECT COALESCE(SUM(s = 1), 0), COALESCE(SUM(s IN (0, 1)), 0) FROM heartbeats WHERE monitor_id = ? AND t >= ?",
    )?
    .query_row([id, since], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok((total > 0).then(|| up as f64 * 100.0 / total as f64))
}
