//! Uptime reports: an analysis endpoint for the UI and scheduled weekly /
//! monthly digests sent through the notification channels.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use anyhow::Result;
use axum::extract::{Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::api::{ApiResult, bad, visible_for};
use crate::audit::Audit;
use crate::auth::{Admin, AuthUser};
use crate::cert::{unix_ms, ymd};
use crate::db::now_ms;
use crate::i18n::pick;
use crate::models::{self, get_setting, set_setting};
use crate::notify::{self, Alert};
use crate::state::AppState;

const DAY_MS: i64 = 86_400_000;

// ---------- numbers ----------

#[derive(Debug, Clone, Serialize)]
pub struct MonitorStats {
    pub id: i64,
    pub name: String,
    pub group_name: Option<String>,
    pub uptime: Option<f64>,
    pub incidents: i64,
    pub downtime_ms: i64,
    pub avg_latency: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Summary {
    pub from: i64,
    pub to: i64,
    pub uptime: Option<f64>,
    pub incidents: i64,
    pub downtime_ms: i64,
    pub avg_latency: Option<f64>,
    pub monitors: Vec<MonitorStats>,
}

/// Uptime figures per monitor over `[from, to)`; maintenance and paused beats are ignored.
pub fn compute(c: &Connection, ids: &HashSet<i64>, from: i64, to: i64) -> Result<Summary> {
    let groups: HashMap<i64, String> = c
        .prepare("SELECT id, name FROM groups")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut st = c.prepare_cached(
        "SELECT COALESCE(SUM(s = 1), 0), COALESCE(SUM(s = 0), 0), AVG(CASE WHEN s = 1 THEN l END), \
         COALESCE(SUM(CASE WHEN s = 0 AND important = 1 THEN 1 ELSE 0 END), 0) \
         FROM heartbeats WHERE monitor_id = ? AND t >= ? AND t < ?",
    )?;
    let (mut tot_up, mut tot_down, mut inc_total, mut downtime_total) = (0i64, 0i64, 0i64, 0i64);
    let (mut lat_sum, mut lat_n) = (0.0f64, 0i64);
    let mut monitors = Vec::new();
    for m in models::list_monitors(c)?.into_iter().filter(|m| ids.contains(&m.id)) {
        let (up, down, avg, incidents): (i64, i64, Option<f64>, i64) =
            st.query_row(rusqlite::params![m.id, from, to], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        let downtime_ms = down * m.cfg.interval as i64 * 1000;
        tot_up += up;
        tot_down += down;
        inc_total += incidents;
        downtime_total += downtime_ms;
        if let Some(a) = avg {
            lat_sum += a * up as f64;
            lat_n += up;
        }
        monitors.push(MonitorStats {
            id: m.id,
            name: m.cfg.name.clone(),
            group_name: m.cfg.group_id.and_then(|g| groups.get(&g).cloned()),
            uptime: (up + down > 0).then(|| up as f64 * 100.0 / (up + down) as f64),
            incidents,
            downtime_ms,
            avg_latency: avg.map(|a| a.round()),
        });
    }
    Ok(Summary {
        from,
        to,
        uptime: (tot_up + tot_down > 0).then(|| tot_up as f64 * 100.0 / (tot_up + tot_down) as f64),
        incidents: inc_total,
        downtime_ms: downtime_total,
        avg_latency: (lat_n > 0).then(|| (lat_sum / lat_n as f64).round()),
        monitors,
    })
}

// ---------- settings ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Schedule {
    pub enabled: bool,
    /// Weekly: 0 = Sunday … 6 = Saturday. Monthly: 1–28.
    pub day: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Settings {
    pub weekly: Schedule,
    pub monthly: Schedule,
    /// Hour of the day (0–23) in the configured timezone.
    pub hour: i64,
    /// Minutes east of UTC.
    pub tz_offset_min: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            weekly: Schedule { enabled: false, day: 1 },
            monthly: Schedule { enabled: false, day: 1 },
            hour: 9,
            tz_offset_min: 0,
        }
    }
}

fn load_settings(c: &Connection) -> Settings {
    get_setting(c, "reports").ok().flatten().and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default()
}

// ---------- local time helpers ----------

struct Local {
    date: String,
    month_key: String,
    weekday: i64,
    day: i64,
    hour: i64,
}

fn local(now: i64, tz: i64) -> Local {
    let ms = now + tz * 60_000;
    let days = ms.div_euclid(DAY_MS);
    let date = ymd(ms);
    let (day, month_key) = (date[8..10].parse().unwrap_or(1), date[..7].to_string());
    Local { date, month_key, weekday: (days + 4).rem_euclid(7), day, hour: ms.rem_euclid(DAY_MS) / 3_600_000 }
}

/// Start (UTC ms) of the calendar month that contains `now` in the given timezone, and of the previous one.
fn month_bounds(now: i64, tz: i64) -> (i64, i64) {
    let l = local(now, tz);
    let (y, m): (i64, i64) = (l.month_key[..4].parse().unwrap_or(2026), l.month_key[5..7].parse().unwrap_or(1));
    let this = unix_ms(y, m, 1, 0, 0, 0) - tz * 60_000;
    let (py, pm) = if m == 1 { (y - 1, 12) } else { (y, m - 1) };
    (unix_ms(py, pm, 1, 0, 0, 0) - tz * 60_000, this)
}

// ---------- the digest text ----------

fn pct(v: Option<f64>) -> String {
    match v {
        Some(v) if v >= 99.995 => "100%".into(),
        Some(v) => format!("{v:.2}%"),
        None => "—".into(),
    }
}

fn duration(ms: i64) -> String {
    let m = ms / 60_000;
    match (m / 1440, (m % 1440) / 60, m % 60) {
        (0, 0, m) => format!("{m} {}", pick("min", "dk")),
        (0, h, m) => format!("{h} {} {m} {}", pick("h", "sa"), pick("min", "dk")),
        (d, h, _) => format!("{d} {} {h} {}", pick("d", "gün"), pick("h", "sa")),
    }
}

fn latency(ms: f64) -> String {
    if ms >= 1000.0 { format!("{:.1} s", ms / 1000.0) } else { format!("{ms:.0} ms") }
}

pub fn digest_text(app: &str, channel: &str, label: &str, tz: i64, s: &Summary, expiring: &[String]) -> String {
    let incidents = |n: i64| if n == 1 { pick("incident", "kesinti") } else { pick("incidents", "kesinti") };
    let mut out = format!(
        "📈 {app} · {label}\n{} → {}\n{channel}\n\n✅ {} {} · {} {} · {} {}",
        ymd(s.from + tz * 60_000),
        ymd(s.to - 1 + tz * 60_000),
        pick("Uptime", "Çalışma süresi"),
        pct(s.uptime),
        s.monitors.len(),
        pick("monitors", "monitör"),
        s.incidents,
        incidents(s.incidents)
    );
    if s.downtime_ms > 0 {
        out.push_str(&format!(" · ~{} {}", duration(s.downtime_ms), pick("down", "kapalı")));
    }

    // Groups
    let mut groups: Vec<(String, Vec<&MonitorStats>)> = Vec::new();
    for m in &s.monitors {
        let g = m.group_name.clone().unwrap_or_else(|| pick("Ungrouped", "Grupsuz").to_string());
        match groups.iter_mut().find(|(n, _)| *n == g) {
            Some((_, v)) => v.push(m),
            None => groups.push((g, vec![m])),
        }
    }
    if groups.len() > 1 {
        out.push_str(&format!("\n\n{}", pick("Groups", "Gruplar")));
        for (name, ms) in &groups {
            let (up, down): (f64, f64) = ms.iter().filter_map(|m| m.uptime).fold((0.0, 0.0), |a, u| (a.0 + u, a.1 + 1.0));
            let avg = (down > 0.0).then(|| up / down);
            let inc: i64 = ms.iter().map(|m| m.incidents).sum();
            out.push_str(&format!("\n▸ {name} ({}) — {} · {inc} {}", ms.len(), pct(avg), incidents(inc)));
        }
    }

    // Needs attention: lowest uptime first
    let mut weak: Vec<&MonitorStats> = s.monitors.iter().filter(|m| m.uptime.is_some_and(|u| u < 99.9) || m.incidents > 0).collect();
    weak.sort_by(|a, b| a.uptime.partial_cmp(&b.uptime).unwrap_or(std::cmp::Ordering::Equal));
    if !weak.is_empty() {
        out.push_str(&format!("\n\n⚠️ {}", pick("Needs attention", "Dikkat gerekenler")));
        for m in weak.iter().take(8) {
            out.push_str(&format!(
                "\n🔴 {} — {} · {} {} · ~{}",
                m.name,
                pct(m.uptime),
                m.incidents,
                incidents(m.incidents),
                duration(m.downtime_ms)
            ));
        }
        if weak.len() > 8 {
            out.push_str(&format!("\n… +{}", weak.len() - 8));
        }
    } else if !s.monitors.is_empty() {
        out.push_str(&format!("\n\n🎉 {}", pick("No incidents. Everything ran smoothly.", "Kesinti yok, her şey sorunsuzdu.")));
    }

    let mut slow: Vec<&MonitorStats> = s.monitors.iter().filter(|m| m.avg_latency.is_some()).collect();
    slow.sort_by(|a, b| b.avg_latency.partial_cmp(&a.avg_latency).unwrap_or(std::cmp::Ordering::Equal));
    if !slow.is_empty() {
        let list: Vec<String> = slow.iter().take(3).map(|m| format!("{} ({})", m.name, latency(m.avg_latency.unwrap_or(0.0)))).collect();
        out.push_str(&format!("\n\n🐢 {}: {}", pick("Slowest", "En yavaşlar"), list.join(", ")));
    }
    if !expiring.is_empty() {
        out.push_str(&format!("\n\n🔐 {}", pick("Expiring soon", "Süresi dolmak üzere olanlar")));
        for line in expiring.iter().take(8) {
            out.push_str(&format!("\n{line}"));
        }
    }
    out
}

/// SSL / domain lines for the given monitors that expire within 30 / 60 days.
fn expiring_lines(state: &AppState, monitors: &[models::Monitor], ids: &HashSet<i64>) -> Vec<String> {
    let now = now_ms();
    let mut items: Vec<(i64, String)> = Vec::new();
    {
        let certs = state.certs.read().unwrap_or_else(|e| e.into_inner());
        for m in monitors.iter().filter(|m| ids.contains(&m.id)) {
            if let Some(c) = certs.get(&m.id).filter(|c| c.expires_at - now <= 30 * DAY_MS) {
                items.push((c.expires_at, format!("• SSL {} — {}", m.cfg.name, ymd(c.expires_at))));
            }
        }
    }
    let domains = state.domains.read().unwrap_or_else(|e| e.into_inner());
    let mine: HashSet<String> = monitors.iter().filter(|m| ids.contains(&m.id)).filter_map(crate::domain::registrable).collect();
    for (d, e) in domains.iter().filter(|(d, _)| mine.contains(*d)) {
        if let Some(x) = e.expires_at.filter(|x| x - now <= 60 * DAY_MS) {
            items.push((x, format!("• {} {d} — {}", pick("Domain", "Alan adı"), ymd(x))));
        }
    }
    items.sort_by_key(|(e, _)| *e);
    items.into_iter().map(|(_, l)| l).collect()
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Period {
    Weekly,
    Monthly,
}

/// Send the digest to every channel that opted in. Returns how many channels got one.
pub async fn send_digests(state: &AppState, period: Period, settings: &Settings) -> Result<usize> {
    let now = now_ms();
    let tz = settings.tz_offset_min;
    let (from, to, label) = match period {
        Period::Weekly => (now - 7 * DAY_MS, now, pick("Weekly report", "Haftalık rapor")),
        Period::Monthly => {
            let (from, to) = month_bounds(now, tz);
            (from, to, pick("Monthly report", "Aylık rapor"))
        }
    };
    let app = state.db.call(|c| crate::brand::get(c)).await?.name;
    let channels: Vec<(crate::notify::Notification, HashSet<i64>)> = state
        .db
        .call(|c| {
            let mut out = Vec::new();
            let mut st = c.prepare("SELECT monitor_id FROM monitor_notifications WHERE notification_id = ?")?;
            for n in notify::list(c)?.into_iter().filter(|n| n.digest) {
                let ids = st.query_map([n.id], |r| r.get::<_, i64>(0))?.collect::<rusqlite::Result<HashSet<_>>>()?;
                if !ids.is_empty() {
                    out.push((n, ids));
                }
            }
            Ok(out)
        })
        .await?;
    let monitors = state.db.call(|c| models::list_monitors(c)).await?;
    let mut sent = 0;
    for (n, ids) in channels {
        let i2 = ids.clone();
        let summary = state.db.call(move |c| compute(c, &i2, from, to)).await?;
        let expiring = expiring_lines(state, &monitors, &ids);
        let body = digest_text(&app, &n.name, label, tz, &summary, &expiring);
        let alert = Alert { title: format!("📈 {app} — {label}"), body, up: true, monitor: None, buttons_for: None };
        match notify::send(state, &n.channel, &alert).await {
            Ok(()) => sent += 1,
            Err(e) => tracing::warn!("report to '{}' failed: {e:#}", n.name),
        }
    }
    Ok(sent)
}

/// Background task: send the digests at the configured time.
pub async fn run(state: AppState) {
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        let Ok(settings) = state.db.call(|c| Ok(load_settings(c))).await else { continue };
        let l = local(now_ms(), settings.tz_offset_min);
        if settings.weekly.enabled && l.weekday == settings.weekly.day && l.hour >= settings.hour {
            let done = state.db.call(|c| get_setting(c, "report_last_weekly")).await.ok().flatten();
            if done.as_deref() != Some(l.date.as_str()) {
                let date = l.date.clone();
                let _ = state.db.call(move |c| set_setting(c, "report_last_weekly", &date)).await;
                if let Err(e) = send_digests(&state, Period::Weekly, &settings).await {
                    tracing::warn!("weekly report failed: {e:#}");
                }
            }
        }
        if settings.monthly.enabled && l.day >= settings.monthly.day && l.hour >= settings.hour {
            let done = state.db.call(|c| get_setting(c, "report_last_monthly")).await.ok().flatten();
            if done.as_deref() != Some(l.month_key.as_str()) {
                let key = l.month_key.clone();
                let _ = state.db.call(move |c| set_setting(c, "report_last_monthly", &key)).await;
                if let Err(e) = send_digests(&state, Period::Monthly, &settings).await {
                    tracing::warn!("monthly report failed: {e:#}");
                }
            }
        }
    }
}

// ---------- API ----------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/reports/summary", get(summary))
        .route("/reports/settings", get(get_settings).put(put_settings))
        .route("/reports/send", post(send_now))
}

#[derive(Deserialize)]
struct SummaryQuery {
    days: Option<i64>,
}

async fn summary(State(st): State<AppState>, AuthUser(user): AuthUser, Query(q): Query<SummaryQuery>) -> ApiResult<Json<Value>> {
    let days = q.days.unwrap_or(7).clamp(1, 365);
    let visible = visible_for(&st, &user).await?;
    let now = now_ms();
    let s = st
        .db
        .call(move |c| {
            let ids: HashSet<i64> = models::list_monitors(c)?.into_iter().map(|m| m.id).filter(|id| visible.as_ref().is_none_or(|v| v.contains(id))).collect();
            compute(c, &ids, now - days * DAY_MS, now)
        })
        .await?;
    Ok(Json(json!(s)))
}

async fn get_settings(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Settings>> {
    Ok(Json(st.db.call(|c| Ok(load_settings(c))).await?))
}

async fn put_settings(State(st): State<AppState>, audit: Audit, Admin(_): Admin, Json(new): Json<Settings>) -> ApiResult<Json<Settings>> {
    let valid = (0..=6).contains(&new.weekly.day)
        && (1..=28).contains(&new.monthly.day)
        && (0..=23).contains(&new.hour)
        && (-840..=840).contains(&new.tz_offset_min);
    if !valid {
        return Err(bad("report_settings_invalid", "The report schedule is not valid"));
    }
    let n2 = new.clone();
    st.db
        .call(move |c| {
            let old = load_settings(c);
            let l = local(now_ms(), n2.tz_offset_min);
            // Newly enabled: the first report goes out at the next scheduled time, not right now.
            if n2.weekly.enabled && !old.weekly.enabled {
                set_setting(c, "report_last_weekly", &l.date)?;
            }
            if n2.monthly.enabled && !old.monthly.enabled {
                set_setting(c, "report_last_monthly", &l.month_key)?;
            }
            set_setting(c, "reports", &serde_json::to_string(&n2)?)
        })
        .await?;
    audit.log("settings.reports", None, Some(json!({ "weekly": new.weekly.enabled, "monthly": new.monthly.enabled })));
    Ok(Json(new))
}

#[derive(Deserialize)]
struct SendReq {
    period: String,
}

async fn send_now(State(st): State<AppState>, audit: Audit, Admin(_): Admin, Json(req): Json<SendReq>) -> ApiResult<Json<Value>> {
    let period = match req.period.as_str() {
        "weekly" => Period::Weekly,
        "monthly" => Period::Monthly,
        _ => return Err(bad("report_period_invalid", "Choose weekly or monthly")),
    };
    let settings = st.db.call(|c| Ok(load_settings(c))).await?;
    let sent = send_digests(&st, period, &settings).await?;
    audit.log("reports.send", None, Some(json!({ "period": req.period, "channels": sent })));
    Ok(Json(json!({ "sent": sent })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(name: &str, group: Option<&str>, uptime: f64, incidents: i64, down_min: i64, lat: f64) -> MonitorStats {
        MonitorStats { id: 1, name: name.into(), group_name: group.map(Into::into), uptime: Some(uptime), incidents, downtime_ms: down_min * 60_000, avg_latency: Some(lat) }
    }

    #[test]
    fn digest_text_lists_groups_and_problems() {
        let s = Summary {
            from: unix_ms(2026, 10, 7, 0, 0, 0),
            to: unix_ms(2026, 10, 14, 0, 0, 0),
            uptime: Some(99.5),
            incidents: 3,
            downtime_ms: 90 * 60_000,
            avg_latency: Some(300.0),
            monitors: vec![
                stats("a.com", Some("Movently"), 100.0, 0, 0, 200.0),
                stats("b.com", Some("Movently"), 98.0, 3, 90, 1200.0),
                stats("c.com", None, 100.0, 0, 0, 250.0),
            ],
        };
        let t = digest_text("Observi", "Movently chat", "Weekly report", 0, &s, &["• SSL c.com — 2026-10-20".into()]);
        assert!(t.contains("99.50%") && t.contains("3 monitors") && t.contains("3 incidents"), "{t}");
        assert!(t.contains("▸ Movently (2)") && t.contains("▸ Ungrouped (1)"), "{t}");
        assert!(t.contains("🔴 b.com — 98.00% · 3 incidents"), "{t}");
        assert!(t.contains("🐢 Slowest: b.com (1.2 s)"), "{t}");
        assert!(t.contains("SSL c.com"), "{t}");
        assert!(t.contains("2026-10-07 → 2026-10-13"), "{t}");
        assert!(t.chars().count() < 4000);
    }

    #[test]
    fn local_time_and_month_bounds() {
        // 2026-10-14 is a Wednesday; in UTC+3 at 22:30 UTC it is already Thursday 01:30.
        let l = local(unix_ms(2026, 10, 14, 22, 30, 0), 180);
        assert_eq!((l.date.as_str(), l.weekday, l.hour, l.day), ("2026-10-15", 4, 1, 15));
        let (from, to) = month_bounds(unix_ms(2026, 10, 14, 12, 0, 0), 0);
        assert_eq!((from, to), (unix_ms(2026, 9, 1, 0, 0, 0), unix_ms(2026, 10, 1, 0, 0, 0)));
        let (from, _) = month_bounds(unix_ms(2026, 1, 3, 12, 0, 0), 0);
        assert_eq!(from, unix_ms(2025, 12, 1, 0, 0, 0));
    }

    #[test]
    fn settings_default_is_off() {
        assert!(!Settings::default().weekly.enabled && !Settings::default().monthly.enabled);
    }
}
