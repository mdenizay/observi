//! Maintenance and mute windows.
//!
//! A window covers some monitors for a period (one-off or recurring weekly):
//! - `maintenance`: checks keep running but the monitor is reported as "under
//!   maintenance": no down/up alerts, excluded from uptime;
//! - `mute`: status and uptime stay normal, only down/up notifications are held back.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use anyhow::Result;
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::api::{ApiError, ApiResult, bad};
use crate::audit::Audit;
use crate::auth::Admin;
use crate::db::now_ms;
use crate::models;
use crate::state::AppState;

const MIN_MS: i64 = 60_000;
const DAY_MIN: i64 = 1440;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Recur {
    /// 0 = Sunday … 6 = Saturday, in the window's own timezone.
    pub days: Vec<u8>,
    /// Minutes after local midnight.
    pub start_min: i64,
    pub duration_min: i64,
    /// Minutes east of UTC.
    pub tz_offset_min: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Maintenance,
    Mute,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Maintenance => "maintenance",
            Kind::Mute => "mute",
        }
    }
    fn parse(s: &str) -> Kind {
        if s == "mute" { Kind::Mute } else { Kind::Maintenance }
    }
}

#[derive(Debug, Clone)]
pub struct Window {
    pub id: i64,
    pub name: String,
    pub kind: Kind,
    pub start_at: Option<i64>,
    pub end_at: Option<i64>,
    pub recur: Option<Recur>,
    pub all: bool,
    pub monitor_ids: Vec<i64>,
    pub group_ids: Vec<i64>,
    pub created_by: Option<String>,
    pub disabled_until: Option<i64>,
}

/// What currently applies to a monitor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ActiveInfo {
    pub id: i64,
    pub kind: Kind,
    pub name: String,
    pub until: Option<i64>,
}

pub type ActiveMap = HashMap<i64, ActiveInfo>;

// ---------- time logic ----------

/// If the window is in effect at `now`, the instant it ends (ms).
pub fn active_until(w: &Window, now: i64) -> Option<i64> {
    if w.disabled_until.is_some_and(|d| now < d) {
        return None;
    }
    if let Some(r) = &w.recur {
        let local_min = (now + r.tz_offset_min * MIN_MS).div_euclid(MIN_MS);
        let today = local_min.div_euclid(DAY_MIN);
        // An occurrence may have started up to a week ago (long windows).
        for back in 0..=7 {
            let day = today - back;
            let weekday = (day + 4).rem_euclid(7) as u8; // 1970-01-01 was a Thursday
            if !r.days.contains(&weekday) {
                continue;
            }
            let start = day * DAY_MIN + r.start_min;
            let end = start + r.duration_min;
            if start <= local_min && local_min < end {
                return Some(now + (end - local_min) * MIN_MS);
            }
        }
        return None;
    }
    match (w.start_at, w.end_at) {
        (Some(s), Some(e)) if s <= now && now < e => Some(e),
        _ => None,
    }
}

/// The next time the window starts (ms), if it is still to come.
pub fn next_start(w: &Window, now: i64) -> Option<i64> {
    if let Some(r) = &w.recur {
        let local_min = (now + r.tz_offset_min * MIN_MS).div_euclid(MIN_MS);
        let today = local_min.div_euclid(DAY_MIN);
        for ahead in 0..=14 {
            let day = today + ahead;
            let weekday = (day + 4).rem_euclid(7) as u8;
            if !r.days.contains(&weekday) {
                continue;
            }
            let start = day * DAY_MIN + r.start_min;
            if start > local_min {
                return Some(start * MIN_MS - r.tz_offset_min * MIN_MS);
            }
        }
        return None;
    }
    w.start_at.filter(|s| *s > now)
}

// ---------- storage ----------

fn ids(c: &Connection, sql: &str, id: i64) -> Result<Vec<i64>> {
    let mut st = c.prepare_cached(sql)?;
    let rows = st.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn row_to_window(c: &Connection, r: &rusqlite::Row) -> Result<Window> {
    let id: i64 = r.get(0)?;
    Ok(Window {
        id,
        name: r.get(1)?,
        kind: Kind::parse(&r.get::<_, String>(2)?),
        start_at: r.get(3)?,
        end_at: r.get(4)?,
        recur: r.get::<_, Option<String>>(5)?.and_then(|j| serde_json::from_str(&j).ok()),
        all: r.get(6)?,
        created_by: r.get(7)?,
        disabled_until: r.get(8)?,
        monitor_ids: ids(c, "SELECT monitor_id FROM maintenance_monitors WHERE maintenance_id = ?", id)?,
        group_ids: ids(c, "SELECT group_id FROM maintenance_groups WHERE maintenance_id = ?", id)?,
    })
}

const COLS: &str = "id, name, kind, start_at, end_at, recur, all_monitors, created_by, disabled_until";

pub fn list_windows(c: &Connection) -> Result<Vec<Window>> {
    let mut st = c.prepare(&format!("SELECT {COLS} FROM maintenance ORDER BY id DESC"))?;
    let mut rows = st.query([])?;
    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        out.push(row_to_window(c, r)?);
    }
    Ok(out)
}

pub fn get_window(c: &Connection, id: i64) -> Result<Option<Window>> {
    let mut st = c.prepare(&format!("SELECT {COLS} FROM maintenance WHERE id = ?"))?;
    let mut rows = st.query([id])?;
    match rows.next()? {
        Some(r) => Ok(Some(row_to_window(c, r)?)),
        None => Ok(None),
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct WindowInput {
    pub name: String,
    #[serde(default)]
    pub kind: Option<Kind>,
    #[serde(default)]
    pub start_at: Option<i64>,
    #[serde(default)]
    pub end_at: Option<i64>,
    #[serde(default)]
    pub recur: Option<Recur>,
    #[serde(default)]
    pub all: bool,
    #[serde(default)]
    pub monitor_ids: Vec<i64>,
    #[serde(default)]
    pub group_ids: Vec<i64>,
}

fn validate(input: &WindowInput) -> Result<(), (&'static str, &'static str)> {
    if input.name.trim().is_empty() {
        return Err(("name_required", "Name is required"));
    }
    if input.name.chars().count() > 80 {
        return Err(("name_too_long", "Name is too long (max 80 characters)"));
    }
    let time_error = ("maintenance_time_invalid", "The schedule is not valid");
    match &input.recur {
        Some(r) => {
            let ok = !r.days.is_empty()
                && r.days.iter().all(|d| *d <= 6)
                && (0..DAY_MIN).contains(&r.start_min)
                && (1..=7 * DAY_MIN).contains(&r.duration_min)
                && (-840..=840).contains(&r.tz_offset_min);
            if !ok {
                return Err(time_error);
            }
        }
        None => match (input.start_at, input.end_at) {
            (Some(s), Some(e)) if s < e => {}
            _ => return Err(time_error),
        },
    }
    if !input.all && input.monitor_ids.is_empty() && input.group_ids.is_empty() {
        return Err(("maintenance_scope_required", "Choose at least one monitor or group"));
    }
    Ok(())
}

fn save_window(c: &Connection, id: Option<i64>, input: &WindowInput, actor: &str) -> Result<i64> {
    let kind = input.kind.unwrap_or(Kind::Maintenance).as_str();
    let recur = input.recur.as_ref().map(serde_json::to_string).transpose()?;
    let (start, end) = if input.recur.is_some() { (None, None) } else { (input.start_at, input.end_at) };
    let id = match id {
        Some(id) => {
            c.execute(
                "UPDATE maintenance SET name=?, kind=?, start_at=?, end_at=?, recur=?, all_monitors=?, disabled_until=NULL WHERE id=?",
                rusqlite::params![input.name.trim(), kind, start, end, recur, input.all, id],
            )?;
            c.execute("DELETE FROM maintenance_monitors WHERE maintenance_id = ?", [id])?;
            c.execute("DELETE FROM maintenance_groups WHERE maintenance_id = ?", [id])?;
            id
        }
        None => {
            c.execute(
                "INSERT INTO maintenance (name, kind, start_at, end_at, recur, all_monitors, created_by, created_at) \
                 VALUES (?,?,?,?,?,?,?,?)",
                rusqlite::params![input.name.trim(), kind, start, end, recur, input.all, actor, now_ms()],
            )?;
            c.last_insert_rowid()
        }
    };
    for m in &input.monitor_ids {
        c.execute(
            "INSERT OR IGNORE INTO maintenance_monitors (maintenance_id, monitor_id) SELECT ?, id FROM monitors WHERE id = ?",
            [id, *m],
        )?;
    }
    for g in &input.group_ids {
        c.execute(
            "INSERT OR IGNORE INTO maintenance_groups (maintenance_id, group_id) SELECT ?, id FROM groups WHERE id = ?",
            [id, *g],
        )?;
    }
    Ok(id)
}

/// A one-off window starting now (used by bulk actions and the Telegram buttons).
pub fn create_quick(c: &Connection, kind: Kind, monitor_ids: &[i64], minutes: i64, actor: &str) -> Result<i64> {
    let now = now_ms();
    let input = WindowInput {
        name: match kind {
            Kind::Maintenance => "Quick maintenance".into(),
            Kind::Mute => "Quick mute".into(),
        },
        kind: Some(kind),
        start_at: Some(now),
        end_at: Some(now + minutes.clamp(1, 30 * DAY_MIN) * MIN_MS),
        recur: None,
        all: false,
        monitor_ids: monitor_ids.to_vec(),
        group_ids: Vec::new(),
    };
    save_window(c, None, &input, actor)
}

/// End the windows that only concern the given monitors. Returns how many ended.
pub fn end_for_monitors(c: &Connection, monitor_ids: &[i64]) -> Result<usize> {
    let now = now_ms();
    let wanted: HashSet<i64> = monitor_ids.iter().copied().collect();
    let mut ended = 0;
    for w in list_windows(c)? {
        let Some(until) = active_until(&w, now) else { continue };
        if w.all || !w.group_ids.is_empty() || w.monitor_ids.is_empty() || !w.monitor_ids.iter().all(|m| wanted.contains(m)) {
            continue;
        }
        end_window(c, &w, now, until)?;
        ended += 1;
    }
    Ok(ended)
}

fn end_window(c: &Connection, w: &Window, now: i64, until: i64) -> Result<()> {
    if w.recur.is_some() {
        c.execute("UPDATE maintenance SET disabled_until = ? WHERE id = ?", rusqlite::params![until, w.id])?;
    } else {
        c.execute("UPDATE maintenance SET end_at = ? WHERE id = ?", rusqlite::params![now, w.id])?;
    }
    Ok(())
}

// ---------- the live map ----------

/// Which window applies to each monitor right now (maintenance wins over mute).
pub fn compute(c: &Connection, now: i64) -> Result<ActiveMap> {
    let windows = list_windows(c)?;
    let mut monitors: Vec<(i64, Option<i64>)> = Vec::new();
    {
        let mut st = c.prepare("SELECT id, group_id FROM monitors")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        for r in rows {
            monitors.push(r?);
        }
    }
    let mut map: ActiveMap = HashMap::new();
    for w in &windows {
        let Some(until) = active_until(w, now) else { continue };
        let info = ActiveInfo { id: w.id, kind: w.kind, name: w.name.clone(), until: Some(until) };
        let direct: HashSet<i64> = w.monitor_ids.iter().copied().collect();
        let groups: HashSet<i64> = w.group_ids.iter().copied().collect();
        for (mid, gid) in &monitors {
            let covered = w.all || direct.contains(mid) || gid.is_some_and(|g| groups.contains(&g));
            if !covered {
                continue;
            }
            let better = match map.get(mid) {
                None => true,
                Some(cur) => match (cur.kind, info.kind) {
                    (Kind::Mute, Kind::Maintenance) => true,
                    (a, b) if a == b => info.until > cur.until,
                    _ => false,
                },
            };
            if better {
                map.insert(*mid, info.clone());
            }
        }
    }
    Ok(map)
}

/// Recompute the live map; when a maintenance period just ended, re-check those
/// monitors right away instead of waiting for their next interval.
pub async fn refresh(state: &AppState) {
    let now = now_ms();
    let map = match state.db.call(move |c| compute(c, now)).await {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("maintenance refresh failed: {e:#}");
            return;
        }
    };
    let (changed, ended): (bool, Vec<i64>) = {
        let mut cur = state.maint.write().unwrap_or_else(|e| e.into_inner());
        let ended = cur
            .iter()
            .filter(|(id, a)| a.kind == Kind::Maintenance && map.get(id).is_none_or(|n| n.kind != Kind::Maintenance))
            .map(|(id, _)| *id)
            .collect();
        let changed = *cur != map;
        *cur = map;
        (changed, ended)
    };
    if !ended.is_empty() {
        let monitors = state
            .db
            .call(move |c| {
                let mut out = Vec::new();
                for id in ended {
                    if let Some(m) = models::get_monitor(c, id)?
                        && m.active
                    {
                        out.push(m);
                    }
                }
                Ok(out)
            })
            .await
            .unwrap_or_default();
        for m in monitors {
            state.scheduler.start(state, m, Duration::ZERO);
        }
    }
    if changed {
        state.notify_monitors_changed();
    }
}

pub async fn run(state: AppState) {
    refresh(&state).await;
    loop {
        tokio::time::sleep(Duration::from_secs(20)).await;
        refresh(&state).await;
    }
}

impl AppState {
    pub fn maintenance_for(&self, monitor_id: i64) -> Option<ActiveInfo> {
        self.maint.read().unwrap_or_else(|e| e.into_inner()).get(&monitor_id).cloned()
    }

    /// True when status notifications for the monitor are being held back.
    pub fn is_muted(&self, monitor_id: i64) -> bool {
        self.maint.read().unwrap_or_else(|e| e.into_inner()).contains_key(&monitor_id)
    }
}

// ---------- API ----------

fn window_json(w: &Window, now: i64) -> Value {
    let until = active_until(w, now);
    json!({
        "id": w.id,
        "name": w.name,
        "kind": w.kind,
        "start_at": w.start_at,
        "end_at": w.end_at,
        "recur": w.recur,
        "all": w.all,
        "monitor_ids": w.monitor_ids,
        "group_ids": w.group_ids,
        "active": until.is_some(),
        "next_start": next_start(w, now),
        "created_by": w.created_by,
    })
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/maintenance", get(list).post(create))
        .route("/maintenance/{id}", axum::routing::put(update).delete(remove))
        .route("/maintenance/{id}/end", post(end))
}

async fn list(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Value>> {
    let now = now_ms();
    let windows = st.db.call(|c| list_windows(c)).await?;
    Ok(Json(json!({ "items": windows.iter().map(|w| window_json(w, now)).collect::<Vec<_>>() })))
}

async fn create(
    State(st): State<AppState>,
    audit: Audit,
    Admin(admin): Admin,
    Json(input): Json<WindowInput>,
) -> ApiResult<Json<Value>> {
    validate(&input).map_err(|(c, m)| bad(c, m))?;
    let (name, actor) = (input.name.trim().to_string(), admin.username.clone());
    let id = st.db.call(move |c| save_window(c, None, &input, &actor)).await?;
    refresh(&st).await;
    audit.log("maintenance.create", Some(("maintenance", id, &name)), None);
    one(&st, id).await
}

async fn update(
    State(st): State<AppState>,
    audit: Audit,
    Admin(admin): Admin,
    Path(id): Path<i64>,
    Json(input): Json<WindowInput>,
) -> ApiResult<Json<Value>> {
    validate(&input).map_err(|(c, m)| bad(c, m))?;
    let (name, actor) = (input.name.trim().to_string(), admin.username.clone());
    let found = st
        .db
        .call(move |c| {
            if get_window(c, id)?.is_none() {
                return Ok(false);
            }
            save_window(c, Some(id), &input, &actor)?;
            Ok(true)
        })
        .await?;
    if !found {
        return Err(ApiError::NotFound);
    }
    refresh(&st).await;
    audit.log("maintenance.update", Some(("maintenance", id, &name)), None);
    one(&st, id).await
}

async fn remove(State(st): State<AppState>, audit: Audit, Admin(_): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let name = st
        .db
        .call(move |c| {
            let name = c
                .query_row("SELECT name FROM maintenance WHERE id = ?", [id], |r| r.get::<_, String>(0))
                .optional()?;
            if name.is_some() {
                c.execute("DELETE FROM maintenance WHERE id = ?", [id])?;
            }
            Ok(name)
        })
        .await?
        .ok_or(ApiError::NotFound)?;
    refresh(&st).await;
    audit.log("maintenance.delete", Some(("maintenance", id, &name)), None);
    Ok(Json(json!({})))
}

async fn end(State(st): State<AppState>, audit: Audit, Admin(_): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let name = st
        .db
        .call(move |c| {
            let Some(w) = get_window(c, id)? else { return Ok(None) };
            let now = now_ms();
            if let Some(until) = active_until(&w, now) {
                end_window(c, &w, now, until)?;
            } else if next_start(&w, now).is_some() && w.recur.is_none() {
                // A scheduled one-off that hasn't started: ending it cancels it.
                c.execute("DELETE FROM maintenance WHERE id = ?", [id])?;
            }
            Ok(Some(w.name))
        })
        .await?
        .ok_or(ApiError::NotFound)?;
    refresh(&st).await;
    audit.log("maintenance.end", Some(("maintenance", id, &name)), None);
    // A cancelled one-off no longer exists.
    match one(&st, id).await {
        Ok(j) => Ok(j),
        Err(_) => Ok(Json(json!({ "id": id, "deleted": true }))),
    }
}

async fn one(st: &AppState, id: i64) -> ApiResult<Json<Value>> {
    let w = st.db.call(move |c| get_window(c, id)).await?.ok_or(ApiError::NotFound)?;
    Ok(Json(window_json(&w, now_ms())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(recur: Option<Recur>, start_at: Option<i64>, end_at: Option<i64>) -> Window {
        Window {
            id: 1,
            name: "t".into(),
            kind: Kind::Maintenance,
            start_at,
            end_at,
            recur,
            all: true,
            monitor_ids: vec![],
            group_ids: vec![],
            created_by: None,
            disabled_until: None,
        }
    }

    fn at(y: i64, mo: i64, d: i64, h: i64, mi: i64) -> i64 {
        crate::cert::unix_ms(y, mo, d, h, mi, 0)
    }

    #[test]
    fn one_off_window() {
        let win = w(None, Some(1000), Some(5000));
        assert_eq!(active_until(&win, 999), None);
        assert_eq!(active_until(&win, 1000), Some(5000));
        assert_eq!(active_until(&win, 5000), None);
        assert_eq!(next_start(&win, 500), Some(1000));
        assert_eq!(next_start(&win, 2000), None);
    }

    #[test]
    fn recurring_window_with_timezone() {
        // Mondays 02:00 for 2 h, in UTC+3 → Mondays 23:00–01:00 UTC (Sun 23:00 UTC .. Mon 01:00 UTC).
        let win = w(Some(Recur { days: vec![1], start_min: 120, duration_min: 120, tz_offset_min: 180 }), None, None);
        // 2026-10-12 is a Monday. 02:30 local = 23:30 UTC on Sunday the 11th.
        let t = at(2026, 10, 11, 23, 30);
        assert_eq!(active_until(&win, t), Some(at(2026, 10, 12, 1, 0)));
        assert_eq!(active_until(&win, at(2026, 10, 12, 1, 0)), None);
        // Tuesday 02:30 local is not covered.
        assert_eq!(active_until(&win, at(2026, 10, 12, 23, 30)), None);
        // From Sunday morning the next start is that night.
        assert_eq!(next_start(&win, at(2026, 10, 11, 9, 0)), Some(at(2026, 10, 11, 23, 0)));
    }

    #[test]
    fn window_crossing_midnight_and_disabled() {
        // Fridays 23:00 for 3 h (UTC): active early Saturday.
        let mut win = w(Some(Recur { days: vec![5], start_min: 23 * 60, duration_min: 180, tz_offset_min: 0 }), None, None);
        let sat_1am = at(2026, 10, 17, 1, 0); // 2026-10-17 is a Saturday
        assert_eq!(active_until(&win, sat_1am), Some(at(2026, 10, 17, 2, 0)));
        win.disabled_until = Some(at(2026, 10, 17, 2, 0));
        assert_eq!(active_until(&win, sat_1am), None);
    }

    #[test]
    fn validation() {
        let mut i = WindowInput {
            name: "x".into(),
            kind: None,
            start_at: Some(1),
            end_at: Some(2),
            recur: None,
            all: true,
            monitor_ids: vec![],
            group_ids: vec![],
        };
        assert!(validate(&i).is_ok());
        i.end_at = Some(1);
        assert_eq!(validate(&i).unwrap_err().0, "maintenance_time_invalid");
        i.end_at = Some(2);
        i.all = false;
        assert_eq!(validate(&i).unwrap_err().0, "maintenance_scope_required");
        i.name = " ".into();
        assert_eq!(validate(&i).unwrap_err().0, "name_required");
    }
}
