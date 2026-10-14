use std::collections::HashSet;
use std::convert::Infallible;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use futures_util::Stream;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::{self, Admin, AuthUser, COOKIE, SESSION_TTL_MS};
use crate::brand;
use crate::update;
use crate::db::now_ms;
use crate::models::{self, Monitor, MonitorConfig, Role, User};
use crate::notify::{self, NotificationInput};
use crate::scheduler;
use crate::state::{AppState, Beat, Event, PAUSED, status_str};

// ---------- errors ----------

pub enum ApiError {
    Unauthorized,
    Forbidden,
    NotFound,
    /// (machine code, English message)
    Bad(&'static str, String),
    TooMany,
    Internal(anyhow::Error),
}

impl From<models::Invalid> for ApiError {
    fn from(e: models::Invalid) -> Self {
        ApiError::Bad(e.0, e.1.to_string())
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError::Internal(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, msg) = match self {
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized", "Sign in required".to_string()),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, "forbidden", "You do not have permission".to_string()),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not_found", "Not found".to_string()),
            ApiError::Bad(code, m) => (StatusCode::BAD_REQUEST, code, m),
            ApiError::TooMany => (
                StatusCode::TOO_MANY_REQUESTS,
                "too_many_attempts",
                "Too many failed attempts. Please try again later.".to_string(),
            ),
            ApiError::Internal(e) => {
                tracing::error!("internal error: {e:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal", "Server error".to_string())
            }
        };
        (status, Json(json!({ "error": msg, "code": code }))).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn bad(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::Bad(code, msg.into())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/auth/password", post(change_password))
        .route("/auth/profile", put(update_profile))
        .route("/monitors", get(list_monitors).post(create_monitor))
        .route("/monitors/{id}", get(get_monitor).put(update_monitor).delete(delete_monitor))
        .route("/monitors/{id}/pause", post(pause_monitor))
        .route("/monitors/{id}/resume", post(resume_monitor))
        .route("/monitors/{id}/stats", get(monitor_stats))
        .route("/monitors/{id}/heartbeats", get(monitor_heartbeats))
        .route("/monitors/{id}/events", get(monitor_events))
        .route("/events", get(events))
        .route("/version", get(version))
        .route("/update", get(update_status))
        .route("/update/check", post(update_check))
        .route("/update/releases", get(update_releases))
        .route("/update/apply", post(update_apply))
        .route("/update/settings", put(update_settings))
        .route("/branding", get(get_branding).put(put_branding))
        .route(
            "/branding/logo",
            get(get_logo).put(put_logo).delete(delete_logo).layer(DefaultBodyLimit::max(2 * brand::MAX_LOGO_BYTES)),
        )
        .route("/groups", get(list_groups).post(create_group))
        .route("/groups/{id}", put(update_group).delete(delete_group))
        .route("/users", get(list_users).post(create_user))
        .route("/users/{id}", put(update_user).delete(delete_user))
        .route("/notifications", get(list_notifications).post(create_notification))
        .route("/notifications/test", post(test_notification))
        .route("/notifications/{id}", put(update_notification).delete(delete_notification))
        .fallback(|| async { ApiError::NotFound })
}

// ---------- auth ----------

#[derive(Deserialize)]
struct LoginReq {
    username: String,
    password: String,
}

fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .unwrap_or("local")
        .trim()
        .to_string()
}

fn is_https(headers: &HeaderMap) -> bool {
    headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()) == Some("https")
}

fn session_cookie(token: &str, max_age_s: i64, secure: bool) -> String {
    format!(
        "{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_s}{}",
        if secure { "; Secure" } else { "" }
    )
}

async fn login(State(st): State<AppState>, headers: HeaderMap, Json(req): Json<LoginReq>) -> ApiResult<Response> {
    let username = req.username.trim().to_lowercase();
    let ip_key = format!("ip:{}", client_ip(&headers));
    let user_key = format!("user:{username}");
    if st.throttle.blocked(&ip_key) || st.throttle.blocked(&user_key) {
        return Err(ApiError::TooMany);
    }
    let password = req.password;
    let uname = username.clone();
    let found = st
        .db
        .call(move |c| {
            let row: Option<(i64, String)> = rusqlite::OptionalExtension::optional(c.query_row(
                "SELECT id, password_hash FROM users WHERE username = ?",
                [&uname],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ))?;
            // Verify against a dummy hash when the user does not exist so timing is similar.
            let ok = match &row {
                Some((_, hash)) => auth::verify_password(&password, hash),
                None => {
                    auth::dummy_verify(&password);
                    false
                }
            };
            if !ok {
                return Ok(None);
            }
            let id = row.map(|r| r.0).unwrap_or_default();
            let token = auth::create_session(c, id)?;
            Ok(Some(token))
        })
        .await?;
    let Some(token) = found else {
        st.throttle.fail(&ip_key);
        st.throttle.fail(&user_key);
        return Err(bad("invalid_credentials", "Invalid username or password"));
    };
    st.throttle.clear(&user_key);
    let t = token.clone();
    let user = st
        .db
        .call(move |c| auth::session_user(c, &t))
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let cookie = session_cookie(&token, SESSION_TTL_MS / 1000, is_https(&headers));
    Ok(([(header::SET_COOKIE, cookie)], Json(user)).into_response())
}

async fn logout(State(st): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let token = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == COOKIE)
        .map(|(_, v)| v.to_string());
    if let Some(token) = token {
        st.db.call(move |c| auth::delete_session(c, &token)).await?;
    }
    let cookie = session_cookie("", 0, is_https(&headers));
    Ok(([(header::SET_COOKIE, cookie)], Json(json!({}))).into_response())
}

async fn me(AuthUser(user): AuthUser) -> Json<User> {
    Json(user)
}

#[derive(Deserialize)]
struct PasswordReq {
    current: String,
    new: String,
}

#[derive(Deserialize)]
struct ProfileReq {
    name: String,
}

async fn update_profile(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<ProfileReq>,
) -> ApiResult<Json<User>> {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(bad("name_required", "Name is required"));
    }
    if name.chars().count() > 80 {
        return Err(bad("name_too_long", "Name is too long (max 80 characters)"));
    }
    let n = name.clone();
    st.db
        .call(move |c| Ok(c.execute("UPDATE users SET name = ? WHERE id = ?", rusqlite::params![n, user.id])?))
        .await?;
    Ok(Json(User { name, ..user }))
}

async fn change_password(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<PasswordReq>,
) -> ApiResult<Json<Value>> {
    if req.new.chars().count() < 8 {
        return Err(bad("password_too_short", "Password must be at least 8 characters"));
    }
    let ok = st
        .db
        .call(move |c| {
            let hash: String = c.query_row("SELECT password_hash FROM users WHERE id = ?", [user.id], |r| r.get(0))?;
            if !auth::verify_password(&req.current, &hash) {
                return Ok(false);
            }
            c.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                rusqlite::params![auth::hash_password(&req.new)?, user.id],
            )?;
            Ok(true)
        })
        .await?;
    if !ok {
        return Err(bad("current_password_wrong", "Current password is incorrect"));
    }
    Ok(Json(json!({})))
}

// ---------- monitors ----------

/// Monitor ids visible to the user, or None meaning "all" (superadmin).
async fn visible_ids(st: &AppState, user: &User) -> ApiResult<Option<HashSet<i64>>> {
    if user.is_admin() {
        return Ok(None);
    }
    let uid = user.id;
    let ids = st.db.call(move |c| models::user_visible_ids(c, uid)).await?;
    Ok(Some(ids.into_iter().collect()))
}

async fn ensure_visible(st: &AppState, user: &User, id: i64) -> ApiResult<()> {
    match visible_ids(st, user).await? {
        Some(ids) if !ids.contains(&id) => Err(ApiError::NotFound),
        _ => Ok(()),
    }
}

fn summary_json(st: &AppState, m: &Monitor, groups: &GroupNames, beats: usize) -> Value {
    let live = st.live.read().unwrap_or_else(|e| e.into_inner());
    let uptime = st.uptime24.read().unwrap_or_else(|e| e.into_inner()).get(&m.id).copied();
    let l = live.get(&m.id);
    let status = if !m.active { Some(PAUSED) } else { l.and_then(|l| l.status) };
    let recent: Vec<&Beat> = l
        .map(|l| {
            let skip = l.beats.len().saturating_sub(beats);
            l.beats.iter().skip(skip).collect()
        })
        .unwrap_or_default();
    json!({
        "id": m.id,
        "name": m.cfg.name,
        "type": m.cfg.kind,
        "url": m.cfg.url,
        "hostname": m.cfg.hostname,
        "port": m.cfg.port,
        "interval": m.cfg.interval,
        "active": m.active,
        "status": status_str(status),
        "latency_ms": l.and_then(|l| l.latency),
        "last_check": l.and_then(|l| l.last_check),
        "message": l.and_then(|l| l.message.clone()),
        "uptime_24h": uptime,
        "cert": state_cert(st, m.id),
        "ssl_problem": l.and_then(|l| l.cert_problem.clone()),
        "group_id": m.cfg.group_id,
        "group_name": m.cfg.group_id.and_then(|g| groups.get(&g)),
        "beats": recent,
    })
}

fn state_cert(st: &AppState, id: i64) -> Value {
    let now = now_ms();
    st.certs
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .map(|c| c.to_json(now))
        .unwrap_or(Value::Null)
}

type GroupNames = std::collections::HashMap<i64, String>;

fn group_names(c: &rusqlite::Connection) -> anyhow::Result<GroupNames> {
    let mut st = c.prepare_cached("SELECT id, name FROM groups")?;
    let map = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    Ok(map)
}

async fn list_monitors(State(st): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Vec<Value>>> {
    let visible = visible_ids(&st, &user).await?;
    let (monitors, groups) = st.db.call(|c| Ok((models::list_monitors(c)?, group_names(c)?))).await?;
    Ok(Json(
        monitors
            .iter()
            .filter(|m| visible.as_ref().is_none_or(|v| v.contains(&m.id)))
            .map(|m| summary_json(&st, m, &groups, 50))
            .collect(),
    ))
}

async fn monitor_full(st: &AppState, id: i64) -> ApiResult<Value> {
    let (m, nids, groups) = st
        .db
        .call(move |c| {
            let m = models::get_monitor(c, id)?;
            let n = models::monitor_notification_ids(c, id)?;
            Ok((m, n, group_names(c)?))
        })
        .await?;
    let m = m.ok_or(ApiError::NotFound)?;
    let mut v = serde_json::to_value(&m).map_err(anyhow::Error::from)?;
    if let (Value::Object(obj), Value::Object(sum)) = (&mut v, summary_json(st, &m, &groups, 50)) {
        obj.extend(sum);
        obj.insert("notification_ids".into(), json!(nids));
    }
    Ok(v)
}

async fn get_monitor(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    ensure_visible(&st, &user, id).await?;
    let mut v = monitor_full(&st, id).await?;
    if !user.is_admin() {
        // Regular users don't need request internals or notification wiring.
        if let Value::Object(o) = &mut v {
            for k in ["headers", "body", "notification_ids"] {
                o.remove(k);
            }
        }
    }
    Ok(Json(v))
}

#[derive(Deserialize)]
struct MonitorReq {
    #[serde(flatten)]
    cfg: MonitorConfig,
    #[serde(default)]
    notification_ids: Option<Vec<i64>>,
}

async fn create_monitor(
    State(st): State<AppState>,
    Admin(_): Admin,
    Json(req): Json<MonitorReq>,
) -> ApiResult<Json<Value>> {
    let cfg = req.cfg.validate()?;
    let nids = req.notification_ids;
    let c2 = cfg.clone();
    let id = st
        .db
        .call(move |c| {
            let tx = c.transaction()?;
            let id = models::insert_monitor(&tx, &c2, true)?;
            let nids = match nids {
                Some(n) => n,
                None => notify::default_ids(&tx)?,
            };
            models::set_monitor_notifications(&tx, id, &nids)?;
            tx.commit()?;
            Ok(id)
        })
        .await?;
    st.live.write().unwrap_or_else(|e| e.into_inner()).entry(id).or_default();
    st.scheduler.start(&st, Monitor { id, active: true, cfg }, Duration::ZERO);
    st.notify_monitors_changed();
    Ok(Json(monitor_full(&st, id).await?))
}

async fn update_monitor(
    State(st): State<AppState>,
    Admin(_): Admin,
    Path(id): Path<i64>,
    Json(req): Json<MonitorReq>,
) -> ApiResult<Json<Value>> {
    let cfg = req.cfg.validate()?;
    let nids = req.notification_ids;
    let c2 = cfg.clone();
    let active = st
        .db
        .call(move |c| {
            let tx = c.transaction()?;
            if !models::update_monitor(&tx, id, &c2)? {
                return Ok(None);
            }
            if let Some(n) = nids {
                models::set_monitor_notifications(&tx, id, &n)?;
            }
            let active: bool = tx.query_row("SELECT active FROM monitors WHERE id = ?", [id], |r| r.get(0))?;
            tx.commit()?;
            Ok(Some(active))
        })
        .await?
        .ok_or(ApiError::NotFound)?;
    if active {
        st.scheduler.start(&st, Monitor { id, active, cfg }, Duration::ZERO);
    }
    st.notify_monitors_changed();
    Ok(Json(monitor_full(&st, id).await?))
}

async fn delete_monitor(State(st): State<AppState>, Admin(_): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    st.scheduler.stop(id);
    let n = st
        .db
        .call(move |c| {
            let n = c.execute("DELETE FROM monitors WHERE id = ?", [id])?;
            c.execute("DELETE FROM heartbeats WHERE monitor_id = ?", [id])?;
            Ok(n)
        })
        .await?;
    st.live.write().unwrap_or_else(|e| e.into_inner()).remove(&id);
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    st.notify_monitors_changed();
    Ok(Json(json!({})))
}

async fn pause_monitor(State(st): State<AppState>, Admin(_): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let n = st
        .db
        .call(move |c| Ok(c.execute("UPDATE monitors SET active = 0 WHERE id = ? AND active = 1", [id])?))
        .await?;
    if n > 0 {
        scheduler::pause(&st, id);
        st.notify_monitors_changed();
    }
    Ok(Json(json!({})))
}

async fn resume_monitor(State(st): State<AppState>, Admin(_): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let m = st
        .db
        .call(move |c| {
            c.execute("UPDATE monitors SET active = 1 WHERE id = ?", [id])?;
            models::get_monitor(c, id)
        })
        .await?
        .ok_or(ApiError::NotFound)?;
    st.scheduler.start(&st, m, Duration::ZERO);
    st.notify_monitors_changed();
    Ok(Json(json!({})))
}

async fn monitor_stats(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    ensure_visible(&st, &user, id).await?;
    let v = st
        .db
        .call(move |c| {
            let now = now_ms();
            let day = 24 * 3600 * 1000;
            let avg: Option<f64> = c
                .prepare_cached("SELECT AVG(l) FROM heartbeats WHERE monitor_id = ? AND t >= ? AND s = 1")?
                .query_row([id, now - day], |r| r.get(0))?;
            Ok(json!({
                "uptime_24h": scheduler::uptime(c, id, now - day)?,
                "uptime_7d": scheduler::uptime(c, id, now - 7 * day)?,
                "uptime_30d": scheduler::uptime(c, id, now - 30 * day)?,
                "avg_latency_24h": avg.map(|a| a.round()),
            }))
        })
        .await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct HoursQuery {
    hours: Option<i64>,
}

const MAX_POINTS: usize = 500;

async fn monitor_heartbeats(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<i64>,
    Query(q): Query<HoursQuery>,
) -> ApiResult<Json<Vec<Beat>>> {
    ensure_visible(&st, &user, id).await?;
    let hours = q.hours.unwrap_or(24).clamp(1, 720);
    let since = now_ms() - hours * 3600 * 1000;
    let beats = st
        .db
        .call(move |c| {
            let mut stmt = c.prepare_cached("SELECT t, s, l, m FROM heartbeats WHERE monitor_id = ? AND t >= ? ORDER BY t")?;
            let rows = stmt
                .query_map([id, since], |r| Ok(Beat { t: r.get(0)?, s: r.get(1)?, l: r.get(2)?, m: r.get(3)? }))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await?;
    Ok(Json(downsample(beats, since, now_ms())))
}

/// Bucket beats into at most MAX_POINTS points. A bucket is DOWN if any beat in
/// it is down (so short outages stay visible); latency is averaged.
fn downsample(beats: Vec<Beat>, from: i64, to: i64) -> Vec<Beat> {
    if beats.len() <= MAX_POINTS {
        return beats;
    }
    let width = ((to - from) / MAX_POINTS as i64).max(1);
    let mut out: Vec<Beat> = Vec::with_capacity(MAX_POINTS);
    let mut cur: Option<(i64, Beat, u64, u32)> = None; // bucket, beat, latency sum, latency count
    let rank = |s: u8| match s {
        0 => 0,
        2 => 1,
        1 => 2,
        _ => 3,
    };
    for b in beats {
        let bucket = (b.t - from) / width;
        match &mut cur {
            Some((bk, acc, sum, n)) if *bk == bucket => {
                if rank(b.s) < rank(acc.s) {
                    acc.s = b.s;
                    acc.m = b.m;
                }
                if let Some(l) = b.l {
                    *sum += l as u64;
                    *n += 1;
                }
                acc.t = b.t;
            }
            _ => {
                if let Some((_, mut acc, sum, n)) = cur.take() {
                    acc.l = (n > 0).then(|| (sum / n as u64) as u32);
                    out.push(acc);
                }
                let (sum, n) = b.l.map(|l| (l as u64, 1)).unwrap_or((0, 0));
                cur = Some((bucket, b, sum, n));
            }
        }
    }
    if let Some((_, mut acc, sum, n)) = cur {
        acc.l = (n > 0).then(|| (sum / n as u64) as u32);
        out.push(acc);
    }
    out
}

#[derive(Deserialize)]
struct LimitQuery {
    limit: Option<i64>,
}

async fn monitor_events(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<i64>,
    Query(q): Query<LimitQuery>,
) -> ApiResult<Json<Vec<Value>>> {
    ensure_visible(&st, &user, id).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let rows = st
        .db
        .call(move |c| {
            let mut stmt = c.prepare_cached(
                "SELECT t, s, m FROM heartbeats WHERE monitor_id = ? AND important = 1 ORDER BY t DESC LIMIT ?",
            )?;
            let rows = stmt
                .query_map([id, limit], |r| {
                    Ok(json!({ "t": r.get::<_, i64>(0)?, "s": r.get::<_, u8>(1)?, "m": r.get::<_, Option<String>>(2)? }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await?;
    Ok(Json(rows))
}

// ---------- live events (SSE) ----------

async fn events(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> ApiResult<Sse<impl Stream<Item = Result<SseEvent, Infallible>>>> {
    let visible = visible_ids(&st, &user).await?;
    let rx = st.events.subscribe();
    let sd = st.shutdown.subscribe();
    let stream = futures_util::stream::unfold((rx, visible, st, user, sd), |(mut rx, mut visible, st, user, mut sd)| async move {
        loop {
            let msg = tokio::select! {
                m = rx.recv() => m,
                _ = sd.changed() => return None,
            };
            match msg {
                Ok(Event::Beat(b)) => {
                    if visible.as_ref().is_some_and(|v| !v.contains(&b.monitor_id)) {
                        continue;
                    }
                    let ev = SseEvent::default()
                        .event("beat")
                        .data(serde_json::to_string(&b).unwrap_or_default());
                    return Some((Ok(ev), (rx, visible, st, user, sd)));
                }
                Ok(Event::MonitorsChanged) => {
                    // Permissions may have changed too; reload the visible set.
                    if let Ok(v) = visible_ids(&st, &user).await {
                        visible = v;
                    }
                    let ev = SseEvent::default().event("monitors").data("{}");
                    return Some((Ok(ev), (rx, visible, st, user, sd)));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let ev = SseEvent::default().event("monitors").data("{}");
                    return Some((Ok(ev), (rx, visible, st, user, sd)));
                }
                Err(_) => return None,
            }
        }
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(20))))
}

// ---------- updates ----------

async fn version() -> Json<Value> {
    Json(json!({ "version": update::CURRENT }))
}

async fn update_json(st: &AppState) -> ApiResult<Json<Value>> {
    let auto = st.db.call(|c| Ok(update::auto_update_enabled(c))).await?;
    Ok(Json(json!(st.updater.status(auto))))
}

async fn update_status(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Value>> {
    update_json(&st).await
}

async fn update_check(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Value>> {
    st.updater.check(&st.http).await;
    update_json(&st).await
}

async fn update_apply(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Value>> {
    update::request(&st).map_err(|code| {
        let msg = match code {
            "update_not_supported" => "This installation cannot update itself",
            "update_in_progress" => "An update is already in progress",
            _ => "No newer version is available",
        };
        bad(code, msg)
    })?;
    update_json(&st).await
}

#[derive(Deserialize)]
struct ReleasesQuery {
    refresh: Option<String>,
}

async fn update_releases(
    State(st): State<AppState>,
    Admin(_): Admin,
    Query(q): Query<ReleasesQuery>,
) -> ApiResult<Json<Value>> {
    let refresh = matches!(q.refresh.as_deref(), Some("1" | "true"));
    let (fetched_at, releases) = st
        .updater
        .releases(&st.http, refresh)
        .await
        .map_err(|e| bad("update_check_failed", format!("{e:#}")))?;
    Ok(Json(json!({ "releases": releases, "fetched_at": fetched_at })))
}

#[derive(Deserialize)]
struct UpdateSettingsReq {
    auto_update: bool,
}

async fn update_settings(
    State(st): State<AppState>,
    Admin(_): Admin,
    Json(req): Json<UpdateSettingsReq>,
) -> ApiResult<Json<Value>> {
    st.db.call(move |c| update::set_auto_update(c, req.auto_update)).await?;
    update_json(&st).await
}

// ---------- branding ----------

async fn current_brand(st: &AppState) -> ApiResult<Json<Value>> {
    let b = st.db.call(|c| brand::get(c)).await?;
    Ok(Json(json!(b)))
}

async fn get_branding(State(st): State<AppState>) -> ApiResult<Response> {
    let body = current_brand(&st).await?;
    Ok(([(header::CACHE_CONTROL, "no-cache")], body).into_response())
}

#[derive(Deserialize)]
struct BrandReq {
    name: String,
}

async fn put_branding(State(st): State<AppState>, Admin(_): Admin, Json(req): Json<BrandReq>) -> ApiResult<Json<Value>> {
    st.db.call(move |c| Ok(brand::set_name(c, &req.name))).await??;
    current_brand(&st).await
}

async fn get_logo(State(st): State<AppState>) -> ApiResult<Response> {
    let (mime, data) = st.db.call(|c| brand::logo(c)).await?.ok_or(ApiError::NotFound)?;
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable".to_string()),
            // An uploaded SVG must never run script if it is opened directly.
            (header::CONTENT_SECURITY_POLICY, "default-src 'none'; style-src 'unsafe-inline'; sandbox".to_string()),
        ],
        data,
    )
        .into_response())
}

async fn put_logo(
    State(st): State<AppState>,
    Admin(_): Admin,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    if body.len() > brand::MAX_LOGO_BYTES {
        return Err(bad("logo_too_large", "Logo must be 512 KB or smaller"));
    }
    let ct = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
    let mime = brand::sniff(ct, &body)
        .ok_or_else(|| bad("logo_type_unsupported", "Logo must be a PNG, JPEG, WebP, GIF or SVG image"))?;
    st.db.call(move |c| brand::set_logo(c, mime, &body)).await?;
    current_brand(&st).await
}

async fn delete_logo(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Value>> {
    st.db.call(|c| brand::clear_logo(c)).await?;
    current_brand(&st).await
}

// ---------- groups ----------

#[derive(Deserialize)]
struct GroupReq {
    name: Option<String>,
    monitor_ids: Option<Vec<i64>>,
}

fn group_name(name: Option<String>) -> ApiResult<Option<String>> {
    match name.map(|n| n.trim().to_string()) {
        Some(n) if n.is_empty() => Err(bad("group_name_required", "Group name is required")),
        Some(n) if n.chars().count() > 80 => Err(bad("group_name_too_long", "Group name is too long")),
        other => Ok(other),
    }
}

async fn list_groups(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Value>> {
    let groups = st.db.call(|c| models::list_groups(c)).await?;
    Ok(Json(json!(groups)))
}

async fn create_group(State(st): State<AppState>, Admin(_): Admin, Json(req): Json<GroupReq>) -> ApiResult<Json<Value>> {
    let name = group_name(req.name)?.ok_or_else(|| bad("group_name_required", "Group name is required"))?;
    let id = st
        .db
        .call(move |c| {
            let tx = c.transaction()?;
            tx.execute("INSERT INTO groups (name) VALUES (?)", [&name])?;
            let id = tx.last_insert_rowid();
            if let Some(ids) = req.monitor_ids {
                models::set_group_monitors(&tx, id, &ids)?;
            }
            tx.commit()?;
            Ok(id)
        })
        .await?;
    st.notify_monitors_changed();
    Ok(Json(json!({ "id": id })))
}

async fn update_group(
    State(st): State<AppState>,
    Admin(_): Admin,
    Path(id): Path<i64>,
    Json(req): Json<GroupReq>,
) -> ApiResult<Json<Value>> {
    let name = group_name(req.name)?;
    let found = st
        .db
        .call(move |c| {
            let tx = c.transaction()?;
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?)", [id], |r| r.get(0))?;
            if !exists {
                return Ok(false);
            }
            if let Some(name) = name {
                tx.execute("UPDATE groups SET name = ? WHERE id = ?", rusqlite::params![name, id])?;
            }
            if let Some(ids) = req.monitor_ids {
                models::set_group_monitors(&tx, id, &ids)?;
            }
            tx.commit()?;
            Ok(true)
        })
        .await?;
    if !found {
        return Err(ApiError::NotFound);
    }
    st.notify_monitors_changed();
    Ok(Json(json!({})))
}

async fn delete_group(State(st): State<AppState>, Admin(_): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let n = st.db.call(move |c| Ok(c.execute("DELETE FROM groups WHERE id = ?", [id])?)).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    st.notify_monitors_changed();
    Ok(Json(json!({})))
}

// ---------- users ----------

#[derive(Deserialize)]
struct CreateUserReq {
    username: String,
    name: String,
    password: String,
    role: Role,
    #[serde(default)]
    monitor_ids: Vec<i64>,
    #[serde(default)]
    group_ids: Vec<i64>,
}

#[derive(Deserialize)]
struct UpdateUserReq {
    name: Option<String>,
    role: Option<Role>,
    password: Option<String>,
    monitor_ids: Option<Vec<i64>>,
    group_ids: Option<Vec<i64>>,
}

async fn list_users(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Vec<Value>>> {
    let users = st
        .db
        .call(|c| {
            let mut stmt =
                c.prepare_cached("SELECT id, username, name, role, created_at FROM users ORDER BY name COLLATE NOCASE")?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut out = Vec::with_capacity(rows.len());
            for (id, username, name, role, created_at) in rows {
                let ids = models::user_monitor_ids(c, id)?;
                let gids = models::user_group_ids(c, id)?;
                out.push(json!({
                    "id": id, "username": username, "name": name, "role": role,
                    "monitor_ids": ids, "group_ids": gids, "created_at": created_at,
                }));
            }
            Ok(out)
        })
        .await?;
    Ok(Json(users))
}

fn valid_username(u: &str) -> bool {
    (2..=64).contains(&u.len()) && u.chars().all(|c| c.is_ascii_alphanumeric() || "._-@".contains(c))
}

async fn create_user(State(st): State<AppState>, Admin(_): Admin, Json(req): Json<CreateUserReq>) -> ApiResult<Json<Value>> {
    let username = req.username.trim().to_lowercase();
    let name = req.name.trim().to_string();
    if !valid_username(&username) {
        return Err(bad("username_invalid", "Username must be 2-64 characters (letters, digits, . _ - @)"));
    }
    if name.is_empty() {
        return Err(bad("name_required", "Name is required"));
    }
    if req.password.chars().count() < 8 {
        return Err(bad("password_too_short", "Password must be at least 8 characters"));
    }
    let res = st
        .db
        .call(move |c| {
            let exists: bool =
                c.query_row("SELECT EXISTS(SELECT 1 FROM users WHERE username = ?)", [&username], |r| r.get(0))?;
            if exists {
                return Ok(None);
            }
            let id = auth::create_user(c, &username, &name, &req.password, req.role)?;
            models::set_user_monitors(c, id, &req.monitor_ids)?;
            models::set_user_groups(c, id, &req.group_ids)?;
            Ok(Some(id))
        })
        .await?;
    match res {
        Some(id) => Ok(Json(json!({ "id": id }))),
        None => Err(bad("username_taken", "This username is already taken")),
    }
}

async fn update_user(
    State(st): State<AppState>,
    Admin(admin): Admin,
    Path(id): Path<i64>,
    Json(req): Json<UpdateUserReq>,
) -> ApiResult<Json<Value>> {
    if id == admin.id && req.role == Some(Role::User) {
        return Err(bad("cannot_demote_self", "You cannot remove your own superadmin role"));
    }
    if let Some(p) = &req.password
        && !p.is_empty() && p.chars().count() < 8 {
            return Err(bad("password_too_short", "Password must be at least 8 characters"));
        }
    let found = st
        .db
        .call(move |c| {
            let tx = c.transaction()?;
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM users WHERE id = ?)", [id], |r| r.get(0))?;
            if !exists {
                return Ok(false);
            }
            if let Some(name) = req.name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
                tx.execute("UPDATE users SET name = ? WHERE id = ?", rusqlite::params![name, id])?;
            }
            if let Some(role) = req.role {
                tx.execute("UPDATE users SET role = ? WHERE id = ?", rusqlite::params![role.as_str(), id])?;
            }
            if let Some(p) = req.password.filter(|p| !p.is_empty()) {
                tx.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    rusqlite::params![auth::hash_password(&p)?, id],
                )?;
                // Log the user out everywhere after a password reset.
                tx.execute("DELETE FROM sessions WHERE user_id = ?", [id])?;
            }
            if let Some(ids) = req.monitor_ids {
                models::set_user_monitors(&tx, id, &ids)?;
            }
            if let Some(ids) = req.group_ids {
                models::set_user_groups(&tx, id, &ids)?;
            }
            tx.commit()?;
            Ok(true)
        })
        .await?;
    if !found {
        return Err(ApiError::NotFound);
    }
    st.notify_monitors_changed();
    Ok(Json(json!({})))
}

async fn delete_user(State(st): State<AppState>, Admin(admin): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    if id == admin.id {
        return Err(bad("cannot_delete_self", "You cannot delete your own account"));
    }
    let n = st.db.call(move |c| Ok(c.execute("DELETE FROM users WHERE id = ?", [id])?)).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(Json(json!({})))
}

// ---------- notifications ----------

async fn list_notifications(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Value>> {
    let list = st.db.call(|c| notify::list(c)).await?;
    Ok(Json(json!(list)))
}

fn validate_notification(n: &mut NotificationInput) -> ApiResult<()> {
    n.name = n.name.trim().to_string();
    if n.name.is_empty() {
        return Err(bad("notification_name_required", "Name is required"));
    }
    Ok(())
}

async fn create_notification(
    State(st): State<AppState>,
    Admin(_): Admin,
    Json(mut n): Json<NotificationInput>,
) -> ApiResult<Json<Value>> {
    validate_notification(&mut n)?;
    let id = st.db.call(move |c| notify::save(c, None, &n)).await?;
    Ok(Json(json!({ "id": id })))
}

async fn update_notification(
    State(st): State<AppState>,
    Admin(_): Admin,
    Path(id): Path<i64>,
    Json(mut n): Json<NotificationInput>,
) -> ApiResult<Json<Value>> {
    validate_notification(&mut n)?;
    st.db.call(move |c| notify::save(c, Some(id), &n)).await.map_err(|_| ApiError::NotFound)?;
    Ok(Json(json!({ "id": id })))
}

async fn delete_notification(State(st): State<AppState>, Admin(_): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    st.db.call(move |c| Ok(c.execute("DELETE FROM notifications WHERE id = ?", [id])?)).await?;
    Ok(Json(json!({})))
}

async fn test_notification(
    State(st): State<AppState>,
    Admin(_): Admin,
    Json(n): Json<NotificationInput>,
) -> ApiResult<Json<Value>> {
    let app = st.db.call(|c| brand::get(c)).await?.name;
    notify::send(&st, &n.channel, &notify::test_alert(&app))
        .await
        .map_err(|e| bad("notification_failed", format!("{e:#}")))?;
    Ok(Json(json!({})))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn beat(t: i64, s: u8, l: u32) -> Beat {
        Beat { t, s, l: Some(l), m: None }
    }

    #[test]
    fn downsample_keeps_short_series() {
        let beats: Vec<Beat> = (0..10).map(|i| beat(i * 1000, 1, 100)).collect();
        assert_eq!(downsample(beats, 0, 10_000).len(), 10);
    }

    #[test]
    fn downsample_keeps_outages_visible() {
        let n = (MAX_POINTS * 4) as i64;
        let beats: Vec<Beat> = (0..n).map(|i| beat(i, if i == 1234 { 0 } else { 1 }, 100)).collect();
        let out = downsample(beats, 0, n);
        assert!(out.len() <= MAX_POINTS + 1);
        assert!(out.iter().any(|b| b.s == 0), "a single down beat must survive bucketing");
    }
}
