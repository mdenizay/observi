//! Dashboard overview: the status heat map (every monitor over time) and the
//! per-user dashboard preferences.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use anyhow::Result;
use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::api::{ApiResult, bad, visible_for};
use crate::auth::AuthUser;
use crate::db::now_ms;
use crate::models;
use crate::state::AppState;

/// (name, hours covered, number of cells)
const RANGES: [(&str, i64, i64); 3] = [("24h", 24, 96), ("7d", 168, 84), ("30d", 720, 90)];
const CACHE_MS: i64 = 60_000;
const MAX_PREFS_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct Row {
    pub id: i64,
    pub name: String,
    pub group_name: Option<String>,
    pub uptime: Option<f64>,
    /// One character per bucket: u up, w partly down, d down, m maintenance, p pending, x paused, - no data.
    pub cells: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Heatmap {
    pub range: &'static str,
    pub from: i64,
    pub to: i64,
    pub bucket_ms: i64,
    pub buckets: i64,
    pub items: Vec<Row>,
}

#[derive(Default)]
pub struct HeatmapCache(Mutex<HashMap<&'static str, (i64, Arc<Heatmap>)>>);

/// The character for one bucket from its beat counts.
pub fn cell(up: i64, down: i64, pending: i64, maintenance: i64, paused: i64) -> char {
    if up + down + pending + maintenance + paused == 0 {
        '-'
    } else if down > 0 {
        if down * 2 >= up + down { 'd' } else { 'w' }
    } else if up > 0 {
        'u'
    } else if maintenance > 0 {
        'm'
    } else if pending > 0 {
        'p'
    } else {
        'x'
    }
}

pub fn compute(c: &Connection, range: &'static str, hours: i64, buckets: i64, now: i64) -> Result<Heatmap> {
    let span = hours * 3_600_000;
    let from = now - span;
    let bucket_ms = span / buckets;
    let groups: HashMap<i64, String> = c
        .prepare("SELECT id, name FROM groups")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut st = c.prepare_cached(
        "SELECT (t - ?2) / ?3 AS b, SUM(s = 1), SUM(s = 0), SUM(s = 2), SUM(s = 4), SUM(s = 3) \
         FROM heartbeats WHERE monitor_id = ?1 AND t >= ?2 AND t < ?4 GROUP BY b",
    )?;
    let mut items = Vec::new();
    for m in models::list_monitors(c)? {
        let mut cells = vec!['-'; buckets as usize];
        let (mut up_total, mut down_total) = (0i64, 0i64);
        let rows = st.query_map(rusqlite::params![m.id, from, bucket_ms, now], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?))
        })?;
        for r in rows {
            let (b, up, down, pending, maint, paused) = r?;
            up_total += up;
            down_total += down;
            if let Some(slot) = cells.get_mut(b.clamp(0, buckets - 1) as usize) {
                *slot = cell(up, down, pending, maint, paused);
            }
        }
        items.push(Row {
            id: m.id,
            name: m.cfg.name.clone(),
            group_name: m.cfg.group_id.and_then(|g| groups.get(&g).cloned()),
            uptime: (up_total + down_total > 0).then(|| up_total as f64 * 100.0 / (up_total + down_total) as f64),
            cells: cells.into_iter().collect(),
        });
    }
    Ok(Heatmap { range, from, to: now, bucket_ms, buckets, items })
}

pub fn router() -> Router<AppState> {
    Router::new().route("/overview/heatmap", get(heatmap)).route("/auth/preferences", get(get_prefs).put(put_prefs))
}

#[derive(Deserialize)]
struct HeatmapQuery {
    range: Option<String>,
}

async fn heatmap(State(st): State<AppState>, AuthUser(user): AuthUser, Query(q): Query<HeatmapQuery>) -> ApiResult<Json<Value>> {
    let wanted = q.range.as_deref().unwrap_or("24h");
    let &(range, hours, buckets) = RANGES
        .iter()
        .find(|(n, _, _)| *n == wanted)
        .ok_or_else(|| bad("range_invalid", "Choose 24h, 7d or 30d"))?;
    let now = now_ms();
    let cached = st
        .heatmaps
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(range)
        .filter(|(at, _)| now - at < CACHE_MS)
        .map(|(_, h)| h.clone());
    let map = match cached {
        Some(m) => m,
        None => {
            let fresh = Arc::new(st.db.call(move |c| compute(c, range, hours, buckets, now)).await?);
            st.heatmaps.0.lock().unwrap_or_else(|e| e.into_inner()).insert(range, (now, fresh.clone()));
            fresh
        }
    };
    let visible = visible_for(&st, &user).await?;
    let items: Vec<&Row> = map.items.iter().filter(|r| visible.as_ref().is_none_or(|v: &HashSet<i64>| v.contains(&r.id))).collect();
    Ok(Json(json!({
        "range": map.range, "from": map.from, "to": map.to, "bucket_ms": map.bucket_ms, "buckets": map.buckets, "items": items,
    })))
}

async fn get_prefs(State(st): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let uid = user.id;
    let data = st
        .db
        .call(move |c| Ok(c.query_row("SELECT data FROM user_prefs WHERE user_id = ?", [uid], |r| r.get::<_, String>(0)).optional()?))
        .await?;
    let prefs: Value = data.and_then(|d| serde_json::from_str(&d).ok()).unwrap_or_else(|| json!({}));
    Ok(Json(json!({ "preferences": prefs })))
}

#[derive(Deserialize)]
struct PrefsReq {
    preferences: Value,
}

async fn put_prefs(State(st): State<AppState>, AuthUser(user): AuthUser, Json(req): Json<PrefsReq>) -> ApiResult<Json<Value>> {
    if !req.preferences.is_object() {
        return Err(bad("preferences_invalid", "Preferences must be a JSON object"));
    }
    let text = req.preferences.to_string();
    if text.len() > MAX_PREFS_BYTES {
        return Err(bad("preferences_too_large", "Preferences are too large"));
    }
    let uid = user.id;
    st.db
        .call(move |c| {
            c.execute(
                "INSERT INTO user_prefs (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data",
                rusqlite::params![uid, text],
            )?;
            Ok(())
        })
        .await?;
    Ok(Json(json!({ "preferences": req.preferences })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cell_rules() {
        assert_eq!(cell(0, 0, 0, 0, 0), '-');
        assert_eq!(cell(10, 0, 0, 0, 0), 'u');
        assert_eq!(cell(9, 1, 0, 0, 0), 'w', "a short blip is only partly down");
        assert_eq!(cell(2, 2, 0, 0, 0), 'd', "half the checks failed");
        assert_eq!(cell(0, 5, 0, 0, 0), 'd');
        assert_eq!(cell(0, 0, 0, 4, 0), 'm');
        assert_eq!(cell(5, 0, 0, 3, 0), 'u', "mostly up with some maintenance counts as up");
        assert_eq!(cell(0, 0, 2, 0, 0), 'p');
        assert_eq!(cell(0, 0, 0, 0, 3), 'x');
    }

    #[test]
    fn compute_buckets_beats() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE groups (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE monitors (id INTEGER PRIMARY KEY, name TEXT, type TEXT, url TEXT, method TEXT, keyword TEXT, invert_keyword INTEGER, hostname TEXT, port INTEGER, interval INTEGER, retry_interval INTEGER, max_retries INTEGER, timeout INTEGER, accepted_status TEXT, ignore_tls INTEGER, upside_down INTEGER, max_redirects INTEGER, headers TEXT, body TEXT, description TEXT, active INTEGER, created_at INTEGER, group_id INTEGER);
             CREATE TABLE heartbeats (monitor_id INTEGER, t INTEGER, s INTEGER, l INTEGER, m TEXT, important INTEGER, PRIMARY KEY (monitor_id, t));
             INSERT INTO monitors (id, name, type, url, method, invert_keyword, interval, retry_interval, max_retries, timeout, accepted_status, ignore_tls, upside_down, max_redirects, active, created_at) VALUES (1, 'a', 'http', 'https://a.example', 'GET', 0, 60, 60, 2, 30, '200-299', 0, 0, 10, 1, 0);",
        )
        .unwrap();
        let now = 100 * 3_600_000i64;
        // 24h range, 96 buckets of 15 min. Put an up beat in the first bucket, a down beat in the last one.
        let from = now - 24 * 3_600_000;
        c.execute("INSERT INTO heartbeats VALUES (1, ?, 1, 100, NULL, 0)", [from + 1000]).unwrap();
        c.execute("INSERT INTO heartbeats VALUES (1, ?, 0, NULL, NULL, 0)", [now - 1000]).unwrap();
        let h = compute(&c, "24h", 24, 96, now).unwrap();
        let row = &h.items[0];
        assert_eq!(row.cells.len(), 96);
        assert_eq!(row.cells.chars().next(), Some('u'));
        assert_eq!(row.cells.chars().last(), Some('d'));
        assert_eq!(row.cells.chars().nth(50), Some('-'));
        assert_eq!(row.uptime, Some(50.0));
    }
}
