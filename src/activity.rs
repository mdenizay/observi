//! Activity feed: status changes and certificate events, shown in the header bell.

use std::collections::HashSet;

use anyhow::Result;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{Value, json};

use crate::db::now_ms;
use crate::models::Monitor;
use crate::state::{AppState, Event};

#[derive(Debug, Clone, Serialize)]
pub struct Activity {
    pub id: i64,
    pub t: i64,
    /// down | up | ssl_expiring | ssl_expired | ssl_renewed
    pub kind: &'static str,
    pub monitor_id: i64,
    pub monitor_name: String,
    pub data: Option<Value>,
}

fn kind_static(kind: &str) -> &'static str {
    match kind {
        "down" => "down",
        "up" => "up",
        "ssl_expiring" => "ssl_expiring",
        "ssl_expired" => "ssl_expired",
        "ssl_renewed" => "ssl_renewed",
        "domain_expiring" => "domain_expiring",
        "domain_expired" => "domain_expired",
        "domain_renewed" => "domain_renewed",
        _ => "up",
    }
}

fn insert(c: &Connection, kind: &'static str, m: &Monitor, data: Option<Value>) -> Result<Activity> {
    let t = now_ms();
    c.execute(
        "INSERT INTO activity (t, kind, monitor_id, monitor_name, data) VALUES (?,?,?,?,?)",
        rusqlite::params![t, kind, m.id, m.cfg.name, data.as_ref().map(|d| d.to_string())],
    )?;
    Ok(Activity { id: c.last_insert_rowid(), t, kind, monitor_id: m.id, monitor_name: m.cfg.name.clone(), data })
}

/// Store an event and push it to connected dashboards.
pub async fn record(state: &AppState, kind: &'static str, m: &Monitor, data: Option<Value>) {
    let m2 = m.clone();
    match state.db.call(move |c| insert(c, kind, &m2, data)).await {
        Ok(item) => {
            let _ = state.events.send(Event::Activity(item));
        }
        Err(e) => tracing::warn!("could not record activity: {e:#}"),
    }
}

pub fn status_data(message: &str, down_for_ms: Option<i64>) -> Value {
    json!({ "message": message, "down_for_ms": down_for_ms })
}

/// Newest first; `visible` restricts to monitors a regular user may see.
pub fn list(c: &Connection, limit: usize, visible: Option<&HashSet<i64>>) -> Result<Vec<Activity>> {
    let mut st = c.prepare_cached(
        "SELECT id, t, kind, monitor_id, monitor_name, data FROM activity ORDER BY id DESC LIMIT 500",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok(Activity {
                id: r.get(0)?,
                t: r.get(1)?,
                kind: kind_static(&r.get::<_, String>(2)?),
                monitor_id: r.get(3)?,
                monitor_name: r.get(4)?,
                data: r.get::<_, Option<String>>(5)?.and_then(|d| serde_json::from_str(&d).ok()),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .filter(|a| visible.is_none_or(|v| v.contains(&a.monitor_id)))
        .take(limit)
        .collect())
}

pub fn prune(c: &Connection, cutoff: i64) -> Result<()> {
    c.execute("DELETE FROM activity WHERE t < ?", [cutoff])?;
    Ok(())
}

/// Seed the feed from past status changes the first time it exists.
pub fn backfill(c: &Connection) -> Result<()> {
    let empty: bool = c.query_row("SELECT NOT EXISTS(SELECT 1 FROM activity)", [], |r| r.get(0))?;
    if !empty {
        return Ok(());
    }
    c.execute(
        "INSERT INTO activity (t, kind, monitor_id, monitor_name, data) \
         SELECT h.t, CASE h.s WHEN 0 THEN 'down' ELSE 'up' END, h.monitor_id, m.name, json_object('message', h.m) \
         FROM heartbeats h JOIN monitors m ON m.id = h.monitor_id \
         WHERE h.important = 1 AND h.s IN (0, 1) AND h.t > ?1 \
           AND EXISTS (SELECT 1 FROM heartbeats p WHERE p.monitor_id = h.monitor_id AND p.important = 1 AND p.t < h.t) \
         ORDER BY h.t ASC",
        [now_ms() - 14 * 24 * 3600 * 1000],
    )?;
    Ok(())
}
