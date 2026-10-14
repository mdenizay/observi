//! Audit log: who did what, when and from where.
//!
//! A middleware gives every API request an [`AuditSlot`]. Handlers record what
//! they did through the [`Audit`] extractor; the authentication extractors fill
//! in the actor. After the response is produced the middleware writes the row
//! (only for successful requests, unless the entry is marked `on_error`).

use std::sync::{Arc, Mutex};

use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::Response;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use crate::db::now_ms;
use crate::models::User;
use crate::state::AppState;

#[derive(Debug, Clone, Default)]
pub struct Entry {
    pub action: String,
    pub target_type: Option<&'static str>,
    pub target_id: Option<i64>,
    pub target_name: Option<String>,
    pub details: Option<Value>,
    /// Record even when the request fails (e.g. a rejected login).
    pub on_error: bool,
}

#[derive(Default)]
struct SlotInner {
    actor: Option<(i64, String)>,
    entry: Option<Entry>,
    ip: String,
}

#[derive(Clone, Default)]
pub struct AuditSlot(Arc<Mutex<SlotInner>>);

impl AuditSlot {
    pub fn set_actor(&self, user: &User) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).actor = Some((user.id, user.username.clone()));
    }
}

/// Extractor handlers use to describe what they did.
pub struct Audit(AuditSlot);

impl Audit {
    pub fn log(&self, action: &str, target: Option<(&'static str, i64, &str)>, details: Option<Value>) {
        let (target_type, target_id, target_name) = match target {
            Some((t, id, name)) => (Some(t), Some(id), Some(name.to_string())),
            None => (None, None, None),
        };
        self.0.0.lock().unwrap_or_else(|e| e.into_inner()).entry = Some(Entry {
            action: action.to_string(),
            target_type,
            target_id,
            target_name,
            details,
            on_error: false,
        });
    }

    /// Like `log`, but kept even if the request is rejected.
    pub fn log_always(&self, action: &str, target_name: Option<&str>, details: Option<Value>) {
        self.0.0.lock().unwrap_or_else(|e| e.into_inner()).entry = Some(Entry {
            action: action.to_string(),
            target_name: target_name.map(str::to_string),
            details,
            on_error: true,
            ..Default::default()
        });
    }

    pub fn actor(&self, user: &User) {
        self.0.set_actor(user);
    }
}

impl FromRequestParts<AppState> for Audit {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &AppState) -> Result<Self, Self::Rejection> {
        Ok(Audit(parts.extensions.get::<AuditSlot>().cloned().unwrap_or_default()))
    }
}

/// Called by the auth extractors once the user is known.
pub fn note_actor(parts: &Parts, user: &User) {
    if let Some(slot) = parts.extensions.get::<AuditSlot>() {
        slot.set_actor(user);
    }
}

pub fn client_ip(headers: &axum::http::HeaderMap) -> String {
    headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .unwrap_or("local")
        .trim()
        .to_string()
}

pub async fn middleware(State(st): State<AppState>, mut req: Request, next: Next) -> Response {
    let slot = AuditSlot::default();
    {
        let mut inner = slot.0.lock().unwrap_or_else(|e| e.into_inner());
        inner.ip = client_ip(req.headers());
    }
    req.extensions_mut().insert(slot.clone());
    let res = next.run(req).await;

    let (entry, actor, ip) = {
        let mut inner = slot.0.lock().unwrap_or_else(|e| e.into_inner());
        (inner.entry.take(), inner.actor.take(), std::mem::take(&mut inner.ip))
    };
    if let Some(entry) = entry
        && (res.status().is_success() || entry.on_error)
    {
        let db = st.db.clone();
        tokio::spawn(async move {
            if let Err(e) = db.call(move |c| insert(c, actor.as_ref().map(|(i, n)| (*i, n.as_str())), &ip, &entry)).await {
                tracing::warn!("audit write failed: {e:#}");
            }
        });
    }
    res
}

pub fn insert(c: &Connection, actor: Option<(i64, &str)>, ip: &str, e: &Entry) -> anyhow::Result<()> {
    c.execute(
        "INSERT INTO audit (t, user_id, username, action, target_type, target_id, target_name, ip, details) \
         VALUES (?,?,?,?,?,?,?,?,?)",
        rusqlite::params![
            now_ms(),
            actor.map(|a| a.0),
            actor.map(|a| a.1),
            e.action,
            e.target_type,
            e.target_id,
            e.target_name,
            ip,
            e.details.as_ref().map(|d| d.to_string()),
        ],
    )?;
    Ok(())
}

/// Record an action that did not come through an HTTP request (e.g. Telegram buttons).
pub async fn record_external(st: &AppState, actor_name: &str, e: Entry) {
    let name = actor_name.to_string();
    let r = st.db.call(move |c| insert(c, None, "", &Entry { details: with_actor(e.details.clone(), &name), ..e })).await;
    if let Err(err) = r {
        tracing::warn!("audit write failed: {err:#}");
    }
}

fn with_actor(details: Option<Value>, actor: &str) -> Option<Value> {
    let mut obj = match details {
        Some(Value::Object(o)) => o,
        _ => Default::default(),
    };
    obj.insert("actor".into(), Value::String(actor.to_string()));
    Some(Value::Object(obj))
}

#[derive(Debug, Serialize)]
pub struct Row {
    pub id: i64,
    pub t: i64,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<i64>,
    pub target_name: Option<String>,
    pub ip: Option<String>,
    pub details: Option<Value>,
}

pub fn list(c: &Connection, limit: usize, before: Option<i64>, action: Option<&str>, user: Option<&str>) -> anyhow::Result<Vec<Row>> {
    let mut sql = String::from(
        "SELECT id, t, user_id, username, action, target_type, target_id, target_name, ip, details FROM audit WHERE 1=1",
    );
    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(b) = before {
        sql.push_str(" AND id < ?");
        params.push(b.into());
    }
    if let Some(a) = action.filter(|a| !a.is_empty()) {
        sql.push_str(" AND (action = ? OR action LIKE ?)");
        params.push(a.to_string().into());
        params.push(format!("{}.%", a.replace(['%', '_'], "")).into());
    }
    if let Some(u) = user.filter(|u| !u.is_empty()) {
        sql.push_str(" AND (username LIKE ? OR target_name LIKE ? OR details LIKE ?)");
        let like = format!("%{}%", u.replace(['%', '_'], ""));
        params.push(like.clone().into());
        params.push(like.clone().into());
        params.push(like.into());
    }
    sql.push_str(" ORDER BY id DESC LIMIT ?");
    params.push((limit as i64).into());
    let mut st = c.prepare(&sql)?;
    let rows = st
        .query_map(rusqlite::params_from_iter(params), |r| {
            Ok(Row {
                id: r.get(0)?,
                t: r.get(1)?,
                user_id: r.get(2)?,
                username: r.get(3)?,
                action: r.get(4)?,
                target_type: r.get(5)?,
                target_id: r.get(6)?,
                target_name: r.get(7)?,
                ip: r.get(8)?,
                details: r.get::<_, Option<String>>(9)?.and_then(|d| serde_json::from_str(&d).ok()),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn prune(c: &Connection, cutoff: i64) -> anyhow::Result<()> {
    c.execute("DELETE FROM audit WHERE t < ?", [cutoff])?;
    Ok(())
}

