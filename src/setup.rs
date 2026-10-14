//! First-run setup: on an empty database the web UI walks the owner through creating the
//! first superadmin. A one-time setup code printed in the server log keeps a stranger who
//! reaches the page first from claiming the instance.

use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::api::{ApiError, ApiResult, bad};
use crate::audit::{Audit, client_ip};
use crate::auth;
use crate::brand;
use crate::models::Role;
use crate::state::AppState;

/// The pending setup code; `None` once the instance has users.
pub type SetupCode = Arc<Mutex<Option<String>>>;

pub fn router() -> Router<AppState> {
    Router::new().route("/setup/status", get(status)).route("/setup", post(complete))
}

fn pending(st: &AppState) -> bool {
    st.setup.lock().unwrap_or_else(|e| e.into_inner()).is_some()
}

async fn status(State(st): State<AppState>) -> Json<Value> {
    Json(json!({ "needed": pending(&st) }))
}

#[derive(Deserialize)]
struct SetupReq {
    code: String,
    username: String,
    name: String,
    password: String,
    #[serde(default)]
    app_name: Option<String>,
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

async fn complete(State(st): State<AppState>, audit: Audit, headers: HeaderMap, Json(req): Json<SetupReq>) -> ApiResult<Response> {
    let ip_key = format!("ip:{}", client_ip(&headers));
    if st.throttle.blocked(&ip_key) {
        return Err(ApiError::TooMany);
    }
    let expected = st.setup.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or_else(|| bad("setup_done", "Setup is already complete"))?;
    if !same(req.code.trim(), &expected) {
        st.throttle.fail(&ip_key);
        return Err(bad("setup_code_invalid", "The setup code is not correct"));
    }
    let username = req.username.trim().to_lowercase();
    let name = req.name.trim().to_string();
    if !(2..=64).contains(&username.len()) || !username.chars().all(|c| c.is_ascii_alphanumeric() || "._-@".contains(c)) {
        return Err(bad("username_invalid", "Username must be 2-64 characters (letters, digits, . _ - @)"));
    }
    if name.is_empty() {
        return Err(bad("name_required", "Name is required"));
    }
    if req.password.chars().count() < 8 {
        return Err(bad("password_too_short", "Password must be at least 8 characters"));
    }
    let app_name = req.app_name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    let (u, password) = (username.clone(), req.password);
    let id = st
        .db
        .call(move |c| {
            let users: i64 = c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
            if users > 0 {
                return Ok(None);
            }
            let id = auth::create_user(c, &u, &name, &password, Role::Superadmin)?;
            if let Some(n) = app_name {
                // A bad brand name must not block the setup; it can be changed later.
                let _ = brand::set_name(c, &n);
            }
            Ok(Some(id))
        })
        .await?;
    let Some(id) = id else {
        *st.setup.lock().unwrap_or_else(|e| e.into_inner()) = None;
        return Err(bad("setup_done", "Setup is already complete"));
    };
    *st.setup.lock().unwrap_or_else(|e| e.into_inner()) = None;
    audit.log_always("setup.complete", Some(&username), None);
    crate::security::finish_password_login(&st, &audit, &headers, id).await
}
