//! Account security: sessions, password reset links, two-factor authentication
//! (TOTP + recovery codes), passkeys (WebAuthn) and API tokens.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::http::{HeaderMap, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::api::{ApiError, ApiResult, bad};
use crate::audit::{Audit, client_ip};
use crate::auth::{self, Admin, AuthUser, COOKIE, SESSION_TTL_MS, SessionMeta};
use crate::db::now_ms;
use crate::models::{Role, User};
use crate::state::AppState;
use crate::{totp, webauthn};

const CHALLENGE_TTL: Duration = Duration::from_secs(5 * 60);

// ---------- short-lived challenges (2FA step, passkey ceremonies) ----------

pub enum ChallengeKind {
    TwoFactor { user_id: i64, attempts: u8 },
    PasskeyRegister { user_id: i64 },
    PasskeyLogin,
}

pub struct Challenge {
    pub kind: ChallengeKind,
    pub bytes: Vec<u8>,
    pub expires: Instant,
}

#[derive(Default)]
pub struct Challenges(Mutex<HashMap<String, Challenge>>);

impl Challenges {
    fn put(&self, kind: ChallengeKind, bytes: Vec<u8>) -> String {
        let id = auth::random_hex(24);
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, c| c.expires > Instant::now());
        map.insert(id.clone(), Challenge { kind, bytes, expires: Instant::now() + CHALLENGE_TTL });
        id
    }

    /// Remove and return a challenge if it is still valid.
    fn take(&self, id: &str) -> Option<Challenge> {
        let c = self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id)?;
        (c.expires > Instant::now()).then_some(c)
    }

    /// Count a failed attempt on a 2FA challenge; drops it after too many.
    fn two_factor_user(&self, id: &str) -> Option<i64> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let c = map.get_mut(id)?;
        if c.expires <= Instant::now() {
            map.remove(id);
            return None;
        }
        match &c.kind {
            ChallengeKind::TwoFactor { user_id, .. } => Some(*user_id),
            _ => None,
        }
    }

    fn two_factor_failed(&self, id: &str) {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let remove = match map.get_mut(id).map(|c| &mut c.kind) {
            Some(ChallengeKind::TwoFactor { attempts, .. }) => {
                *attempts += 1;
                *attempts >= 5
            }
            _ => false,
        };
        if remove {
            map.remove(id);
        }
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/security", get(overview))
        .route("/auth/sessions", get(list_sessions))
        .route("/auth/sessions/revoke-others", post(revoke_other_sessions))
        .route("/auth/sessions/{id}", delete(revoke_session))
        .route("/auth/reset/{token}", get(check_reset))
        .route("/auth/reset", post(do_reset))
        .route("/auth/2fa/setup", post(totp_setup))
        .route("/auth/2fa/enable", post(totp_enable))
        .route("/auth/2fa/disable", post(totp_disable))
        .route("/auth/2fa/recovery-codes", post(totp_recovery_codes))
        .route("/auth/login/2fa", post(login_second_factor))
        .route("/auth/passkeys", get(list_passkeys))
        .route("/auth/passkeys/{id}", delete(remove_passkey))
        .route("/auth/passkeys/options", post(passkey_register_options))
        .route("/auth/passkeys/register", post(passkey_register))
        .route("/auth/passkey/options", post(passkey_login_options))
        .route("/auth/passkey/login", post(passkey_login))
        .route("/tokens", get(list_tokens).post(create_token))
        .route("/tokens/{id}", delete(delete_token))
        .route("/users/{id}/reset-link", post(admin_reset_link))
        .route("/users/{id}/sessions/revoke", post(admin_revoke_sessions))
        .route("/users/{id}/security/reset", post(admin_security_reset))
}

// ---------- shared helpers ----------

fn is_https(headers: &HeaderMap) -> bool {
    headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()) == Some("https")
}

fn session_cookie(token: &str, max_age_s: i64, secure: bool) -> String {
    format!("{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_s}{}", if secure { "; Secure" } else { "" })
}

pub fn current_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == COOKIE)
        .map(|(_, v)| v.to_string())
}

fn load_user(c: &Connection, id: i64) -> anyhow::Result<Option<User>> {
    Ok(c.query_row("SELECT id, username, name, role FROM users WHERE id = ?", [id], |r| {
        Ok(User { id: r.get(0)?, username: r.get(1)?, name: r.get(2)?, role: Role::parse(&r.get::<_, String>(3)?) })
    })
    .optional()?)
}

fn has_totp(c: &Connection, user_id: i64) -> anyhow::Result<bool> {
    Ok(c.query_row("SELECT EXISTS(SELECT 1 FROM user_totp WHERE user_id = ? AND enabled = 1)", [user_id], |r| r.get(0))?)
}

/// Start a session for the user and answer with the user and the cookie.
async fn start_session(st: &AppState, audit: &Audit, headers: &HeaderMap, user_id: i64, method: &'static str, detail: Value) -> ApiResult<Response> {
    let meta = SessionMeta::from_headers(headers, method);
    let (token, user) = st
        .db
        .call(move |c| {
            let token = auth::create_session(c, user_id, &meta)?;
            Ok((token, load_user(c, user_id)?))
        })
        .await?;
    let user = user.ok_or(ApiError::Unauthorized)?;
    audit.actor(&user);
    audit.log("auth.login", Some(("user", user.id, &user.username)), Some(detail));
    let cookie = session_cookie(&token, SESSION_TTL_MS / 1000, is_https(headers));
    Ok(([(header::SET_COOKIE, cookie)], Json(user)).into_response())
}

/// After the password was verified: ask for the second factor if the user has one.
pub async fn finish_password_login(st: &AppState, audit: &Audit, headers: &HeaderMap, user_id: i64) -> ApiResult<Response> {
    let (needs, username) = st
        .db
        .call(move |c| Ok((has_totp(c, user_id)?, load_user(c, user_id)?.map(|u| u.username))))
        .await?;
    if needs {
        let challenge = st.challenges.put(ChallengeKind::TwoFactor { user_id, attempts: 0 }, Vec::new());
        return Ok(Json(json!({ "needs_2fa": true, "challenge": challenge, "username": username })).into_response());
    }
    start_session(st, audit, headers, user_id, "password", json!({ "method": "password" })).await
}

async fn verify_password_of(st: &AppState, user_id: i64, password: String) -> ApiResult<()> {
    let ok = st
        .db
        .call(move |c| {
            let hash: String = c.query_row("SELECT password_hash FROM users WHERE id = ?", [user_id], |r| r.get(0))?;
            Ok(auth::verify_password(&password, &hash))
        })
        .await?;
    if ok { Ok(()) } else { Err(bad("current_password_wrong", "Current password is incorrect")) }
}

enum Factor {
    Totp,
    Recovery,
}

/// Check a TOTP code or a recovery code; on success the code is consumed.
fn check_second_factor(c: &Connection, user_id: i64, code: &str) -> anyhow::Result<Option<Factor>> {
    let row: Option<(String, i64)> = c
        .query_row("SELECT secret, last_step FROM user_totp WHERE user_id = ? AND enabled = 1", [user_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let Some((secret, last_step)) = row else { return Ok(None) };
    let now_secs = (now_ms() / 1000) as u64;
    if let Some(step) = totp::verify(&secret, code, now_secs, last_step) {
        c.execute("UPDATE user_totp SET last_step = ? WHERE user_id = ?", rusqlite::params![step, user_id])?;
        return Ok(Some(Factor::Totp));
    }
    let hash = totp::recovery_hash(code);
    let id: Option<i64> = c
        .query_row("SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL", rusqlite::params![user_id, hash], |r| r.get(0))
        .optional()?;
    if let Some(id) = id {
        c.execute("UPDATE recovery_codes SET used_at = ? WHERE id = ?", rusqlite::params![now_ms(), id])?;
        return Ok(Some(Factor::Recovery));
    }
    Ok(None)
}

fn new_recovery_codes(c: &Connection, user_id: i64) -> anyhow::Result<Vec<String>> {
    c.execute("DELETE FROM recovery_codes WHERE user_id = ?", [user_id])?;
    let codes = totp::recovery_codes();
    for code in &codes {
        c.execute("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)", rusqlite::params![user_id, totp::recovery_hash(code)])?;
    }
    Ok(codes)
}

// ---------- overview ----------

async fn overview(State(st): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let uid = user.id;
    let v = st
        .db
        .call(move |c| {
            let count = |sql: &str| c.query_row(sql, [uid], |r| r.get::<_, i64>(0));
            Ok(json!({
                "two_factor": {
                    "enabled": has_totp(c, uid)?,
                    "recovery_remaining": count("SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL")?,
                },
                "passkeys": count("SELECT COUNT(*) FROM passkeys WHERE user_id = ?")?,
                "tokens": count("SELECT COUNT(*) FROM api_tokens WHERE user_id = ?")?,
                "sessions": c.query_row("SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > ?", rusqlite::params![uid, now_ms()], |r| r.get::<_, i64>(0))?,
            }))
        })
        .await?;
    Ok(Json(v))
}

// ---------- sessions ----------

/// "Chrome · macOS" from a User-Agent string.
pub fn device_label(ua: &str) -> String {
    let browser = if ua.contains("Edg/") {
        "Edge"
    } else if ua.contains("OPR/") || ua.contains("Opera") {
        "Opera"
    } else if ua.contains("Firefox/") {
        "Firefox"
    } else if ua.contains("Chrome/") || ua.contains("CriOS/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else if ua.starts_with("curl") {
        "curl"
    } else if ua.is_empty() {
        "Unknown"
    } else {
        "Other"
    };
    let os = if ua.contains("iPhone") {
        "iOS"
    } else if ua.contains("iPad") {
        "iPadOS"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("Windows") {
        "Windows"
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        "macOS"
    } else if ua.contains("CrOS") {
        "ChromeOS"
    } else if ua.contains("Linux") || ua.contains("X11") {
        "Linux"
    } else {
        ""
    };
    if os.is_empty() { browser.to_string() } else { format!("{browser} · {os}") }
}

async fn list_sessions(State(st): State<AppState>, headers: HeaderMap, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let current = current_token(&headers).map(|t| auth::session_public_id(&t));
    let uid = user.id;
    let items = st
        .db
        .call(move |c| {
            let mut stmt = c.prepare(
                "SELECT substr(token_hash, 1, 16), created_at, last_seen_at, ip, user_agent, method FROM sessions \
                 WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC",
            )?;
            let rows = stmt
                .query_map(rusqlite::params![uid, now_ms()], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await?;
    let items: Vec<Value> = items
        .into_iter()
        .map(|(id, created, seen, ip, ua, method)| {
            json!({
                "id": id,
                "current": current.as_deref() == Some(id.as_str()),
                "created_at": created,
                "last_seen_at": seen,
                "ip": ip,
                "device": device_label(ua.as_deref().unwrap_or("")),
                "method": method,
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

async fn revoke_session(State(st): State<AppState>, audit: Audit, AuthUser(user): AuthUser, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let uid = user.id;
    let n = st
        .db
        .call(move |c| Ok(c.execute("DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?", rusqlite::params![uid, id])?))
        .await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    audit.log("auth.session_revoked", Some(("user", user.id, &user.username)), None);
    Ok(Json(json!({})))
}

async fn revoke_other_sessions(State(st): State<AppState>, audit: Audit, headers: HeaderMap, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let keep = current_token(&headers).map(|t| auth::session_public_id(&t)).unwrap_or_default();
    let uid = user.id;
    let n = st
        .db
        .call(move |c| Ok(c.execute("DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) != ?", rusqlite::params![uid, keep])?))
        .await?;
    audit.log("auth.sessions_revoked", Some(("user", user.id, &user.username)), Some(json!({ "count": n })));
    Ok(Json(json!({ "revoked": n })))
}

// ---------- password reset links ----------

#[derive(Deserialize, Default)]
struct ResetLinkReq {
    hours: Option<i64>,
}

async fn admin_reset_link(
    State(st): State<AppState>,
    audit: Audit,
    Admin(admin): Admin,
    Path(id): Path<i64>,
    body: Option<Json<ResetLinkReq>>,
) -> ApiResult<Json<Value>> {
    let hours = body.and_then(|b| b.0.hours).unwrap_or(24).clamp(1, 168);
    let token = auth::random_hex(32);
    let (t2, actor) = (token.clone(), admin.username.clone());
    let expires_at = now_ms() + hours * 3_600_000;
    let user = st
        .db
        .call(move |c| {
            let Some(user) = load_user(c, id)? else { return Ok(None) };
            // One live link per user.
            c.execute("DELETE FROM password_resets WHERE user_id = ?", [id])?;
            c.execute(
                "INSERT INTO password_resets (token_hash, user_id, expires_at, created_at, created_by) VALUES (?,?,?,?,?)",
                rusqlite::params![auth::api_token_hash(&t2), id, expires_at, now_ms(), actor],
            )?;
            Ok(Some(user))
        })
        .await?
        .ok_or(ApiError::NotFound)?;
    audit.log("user.reset_link", Some(("user", id, &user.username)), Some(json!({ "hours": hours })));
    Ok(Json(json!({ "token": token, "path": format!("/reset?token={token}"), "expires_at": expires_at, "username": user.username })))
}

async fn check_reset(State(st): State<AppState>, headers: HeaderMap, Path(token): Path<String>) -> ApiResult<Json<Value>> {
    let key = format!("reset:{}", client_ip(&headers));
    if st.throttle.blocked(&key) {
        return Err(ApiError::TooMany);
    }
    let found = st
        .db
        .call(move |c| {
            Ok(c.query_row(
                "SELECT u.name FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires_at > ?",
                rusqlite::params![auth::api_token_hash(&token), now_ms()],
                |r| r.get::<_, String>(0),
            )
            .optional()?)
        })
        .await?;
    if found.is_none() {
        st.throttle.fail(&key);
    }
    Ok(Json(json!({ "valid": found.is_some(), "name": found })))
}

#[derive(Deserialize)]
struct ResetReq {
    token: String,
    password: String,
}

async fn do_reset(State(st): State<AppState>, audit: Audit, headers: HeaderMap, Json(req): Json<ResetReq>) -> ApiResult<Json<Value>> {
    let key = format!("reset:{}", client_ip(&headers));
    if st.throttle.blocked(&key) {
        return Err(ApiError::TooMany);
    }
    if req.password.chars().count() < 8 {
        return Err(bad("password_too_short", "Password must be at least 8 characters"));
    }
    let hash = auth::hash_password(&req.password)?;
    let th = auth::api_token_hash(&req.token);
    let user = st
        .db
        .call(move |c| {
            let uid: Option<i64> = c
                .query_row("SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?", rusqlite::params![th, now_ms()], |r| r.get(0))
                .optional()?;
            let Some(uid) = uid else { return Ok(None) };
            c.execute("UPDATE users SET password_hash = ? WHERE id = ?", rusqlite::params![hash, uid])?;
            c.execute("DELETE FROM password_resets WHERE user_id = ?", [uid])?;
            c.execute("DELETE FROM sessions WHERE user_id = ?", [uid])?;
            load_user(c, uid)
        })
        .await?;
    let Some(user) = user else {
        st.throttle.fail(&key);
        return Err(bad("reset_link_invalid", "This reset link is invalid or has expired"));
    };
    audit.actor(&user);
    audit.log("auth.password_reset", Some(("user", user.id, &user.username)), None);
    Ok(Json(json!({})))
}

async fn admin_revoke_sessions(State(st): State<AppState>, audit: Audit, Admin(_): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let (n, name) = st
        .db
        .call(move |c| Ok((c.execute("DELETE FROM sessions WHERE user_id = ?", [id])?, load_user(c, id)?.map(|u| u.username))))
        .await?;
    let name = name.ok_or(ApiError::NotFound)?;
    audit.log("user.sessions_revoked", Some(("user", id, &name)), Some(json!({ "count": n })));
    Ok(Json(json!({ "revoked": n })))
}

/// Lost phone / lost passkey: remove every second factor of the user and sign them out.
async fn admin_security_reset(State(st): State<AppState>, audit: Audit, Admin(_): Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let name = st
        .db
        .call(move |c| {
            let Some(user) = load_user(c, id)? else { return Ok(None) };
            c.execute("DELETE FROM user_totp WHERE user_id = ?", [id])?;
            c.execute("DELETE FROM recovery_codes WHERE user_id = ?", [id])?;
            c.execute("DELETE FROM passkeys WHERE user_id = ?", [id])?;
            c.execute("DELETE FROM sessions WHERE user_id = ?", [id])?;
            Ok(Some(user.username))
        })
        .await?
        .ok_or(ApiError::NotFound)?;
    audit.log("user.security_reset", Some(("user", id, &name)), None);
    Ok(Json(json!({})))
}

// ---------- two-factor authentication ----------

async fn totp_setup(State(st): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let uid = user.id;
    if st.db.call(move |c| has_totp(c, uid)).await? {
        return Err(bad("two_factor_already_enabled", "Two-factor authentication is already enabled"));
    }
    let secret = totp::new_secret();
    let s2 = secret.clone();
    st.db
        .call(move |c| {
            c.execute(
                "INSERT INTO user_totp (user_id, secret, enabled, last_step, created_at) VALUES (?, ?, 0, 0, ?) \
                 ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0, last_step = 0, created_at = excluded.created_at",
                rusqlite::params![uid, s2, now_ms()],
            )?;
            Ok(())
        })
        .await?;
    let issuer = st.db.call(|c| crate::brand::get(c)).await?.name;
    let url = totp::otpauth_url(&issuer, &user.username, &secret);
    Ok(Json(json!({ "secret": secret, "otpauth_url": url, "qr_svg": totp::qr_svg(&url)? })))
}

#[derive(Deserialize)]
struct CodeReq {
    code: String,
}

async fn totp_enable(State(st): State<AppState>, audit: Audit, AuthUser(user): AuthUser, Json(req): Json<CodeReq>) -> ApiResult<Json<Value>> {
    let uid = user.id;
    let result = st
        .db
        .call(move |c| {
            let row: Option<(String, bool)> = c
                .query_row("SELECT secret, enabled FROM user_totp WHERE user_id = ?", [uid], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?;
            let Some((secret, enabled)) = row else { return Ok(Err("two_factor_not_setup")) };
            if enabled {
                return Ok(Err("two_factor_already_enabled"));
            }
            let Some(step) = totp::verify(&secret, &req.code, (now_ms() / 1000) as u64, 0) else { return Ok(Err("invalid_code")) };
            c.execute("UPDATE user_totp SET enabled = 1, last_step = ? WHERE user_id = ?", rusqlite::params![step, uid])?;
            Ok(Ok(new_recovery_codes(c, uid)?))
        })
        .await?;
    match result {
        Ok(codes) => {
            audit.log("auth.2fa_enabled", Some(("user", user.id, &user.username)), None);
            Ok(Json(json!({ "recovery_codes": codes })))
        }
        Err("two_factor_not_setup") => Err(bad("two_factor_not_setup", "Start the setup first")),
        Err("two_factor_already_enabled") => Err(bad("two_factor_already_enabled", "Two-factor authentication is already enabled")),
        Err(_) => Err(bad("invalid_code", "The code is not correct")),
    }
}

#[derive(Deserialize)]
struct PasswordAndCode {
    password: String,
    code: String,
}

async fn require_password_and_factor(st: &AppState, user_id: i64, req: PasswordAndCode) -> ApiResult<()> {
    verify_password_of(st, user_id, req.password).await?;
    let code = req.code;
    let ok = st.db.call(move |c| Ok(check_second_factor(c, user_id, &code)?.is_some())).await?;
    if ok { Ok(()) } else { Err(bad("invalid_code", "The code is not correct")) }
}

async fn totp_disable(State(st): State<AppState>, audit: Audit, AuthUser(user): AuthUser, Json(req): Json<PasswordAndCode>) -> ApiResult<Json<Value>> {
    let uid = user.id;
    if !st.db.call(move |c| has_totp(c, uid)).await? {
        return Err(bad("two_factor_not_enabled", "Two-factor authentication is not enabled"));
    }
    require_password_and_factor(&st, uid, req).await?;
    st.db
        .call(move |c| {
            c.execute("DELETE FROM user_totp WHERE user_id = ?", [uid])?;
            c.execute("DELETE FROM recovery_codes WHERE user_id = ?", [uid])?;
            Ok(())
        })
        .await?;
    audit.log("auth.2fa_disabled", Some(("user", user.id, &user.username)), None);
    Ok(Json(json!({})))
}

async fn totp_recovery_codes(State(st): State<AppState>, audit: Audit, AuthUser(user): AuthUser, Json(req): Json<PasswordAndCode>) -> ApiResult<Json<Value>> {
    let uid = user.id;
    if !st.db.call(move |c| has_totp(c, uid)).await? {
        return Err(bad("two_factor_not_enabled", "Two-factor authentication is not enabled"));
    }
    require_password_and_factor(&st, uid, req).await?;
    let codes = st.db.call(move |c| new_recovery_codes(c, uid)).await?;
    audit.log("auth.recovery_codes_regenerated", Some(("user", user.id, &user.username)), None);
    Ok(Json(json!({ "recovery_codes": codes })))
}

#[derive(Deserialize)]
struct SecondFactorReq {
    challenge: String,
    code: String,
}

async fn login_second_factor(State(st): State<AppState>, audit: Audit, headers: HeaderMap, Json(req): Json<SecondFactorReq>) -> ApiResult<Response> {
    let ip_key = format!("2fa:{}", client_ip(&headers));
    if st.throttle.blocked(&ip_key) {
        audit.log_always("auth.login_blocked", None, Some(json!({ "step": "2fa" })));
        return Err(ApiError::TooMany);
    }
    let Some(uid) = st.challenges.two_factor_user(&req.challenge) else {
        return Err(bad("challenge_expired", "The sign-in step expired. Start again."));
    };
    let code = req.code.clone();
    let factor = st.db.call(move |c| check_second_factor(c, uid, &code)).await?;
    let Some(factor) = factor else {
        st.challenges.two_factor_failed(&req.challenge);
        st.throttle.fail(&ip_key);
        let name = st.db.call(move |c| Ok(load_user(c, uid)?.map(|u| u.username))).await?;
        audit.log_always("auth.2fa_failed", name.as_deref(), None);
        return Err(bad("invalid_code", "The code is not correct"));
    };
    st.challenges.take(&req.challenge);
    st.throttle.clear(&ip_key);
    let (method, kind) = match factor {
        Factor::Totp => ("password+2fa", "totp"),
        Factor::Recovery => ("recovery", "recovery_code"),
    };
    start_session(&st, &audit, &headers, uid, method, json!({ "method": "password", "second_factor": kind })).await
}

// ---------- passkeys ----------

/// The relying-party id and origin the browser sees. `OBSERVI_PUBLIC_URL` pins them.
fn relying_party(headers: &HeaderMap) -> (String, String) {
    if let Ok(url) = std::env::var("OBSERVI_PUBLIC_URL")
        && let Ok(u) = reqwest::Url::parse(url.trim())
        && let Some(host) = u.host_str()
    {
        let origin = u.origin().ascii_serialization();
        return (host.to_string(), origin);
    }
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost")
        .split(',')
        .next()
        .unwrap_or("localhost")
        .trim()
        .to_string();
    let scheme = if is_https(headers) { "https" } else { "http" };
    let rp_id = host.rsplit_once(':').filter(|(_, p)| p.chars().all(|c| c.is_ascii_digit())).map(|(h, _)| h).unwrap_or(&host).to_string();
    (rp_id, format!("{scheme}://{host}"))
}

fn user_handle(id: i64) -> String {
    webauthn::b64_encode(&id.to_be_bytes())
}

fn credential_parts(cred: &Value, fields: &[&str]) -> Option<Vec<Vec<u8>>> {
    let r = &cred["response"];
    let parts = fields.iter().map(|f| r[*f].as_str().and_then(|s| webauthn::b64_decode(s).ok())).collect::<Option<Vec<_>>>()?;
    parts.iter().all(|p| !p.is_empty()).then_some(parts)
}

async fn passkey_register_options(State(st): State<AppState>, headers: HeaderMap, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let (rp_id, _) = relying_party(&headers);
    let uid = user.id;
    let existing: Vec<Vec<u8>> = st
        .db
        .call(move |c| {
            let mut stmt = c.prepare("SELECT cred_id FROM passkeys WHERE user_id = ?")?;
            Ok(stmt.query_map([uid], |r| r.get::<_, Vec<u8>>(0))?.collect::<rusqlite::Result<_>>()?)
        })
        .await?;
    let mut challenge = vec![0u8; 32];
    rand::fill(&mut challenge[..]);
    let id = st.challenges.put(ChallengeKind::PasskeyRegister { user_id: uid }, challenge.clone());
    let app = st.db.call(|c| crate::brand::get(c)).await?.name;
    Ok(Json(json!({
        "challenge_id": id,
        "publicKey": {
            "rp": { "id": rp_id, "name": app },
            "user": { "id": user_handle(user.id), "name": user.username, "displayName": user.name },
            "challenge": webauthn::b64_encode(&challenge),
            "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
            "timeout": 120_000,
            "attestation": "none",
            "authenticatorSelection": { "residentKey": "preferred", "userVerification": "required" },
            "excludeCredentials": existing.iter().map(|c| json!({ "type": "public-key", "id": webauthn::b64_encode(c) })).collect::<Vec<_>>(),
        }
    })))
}

#[derive(Deserialize)]
struct PasskeyRegisterReq {
    challenge_id: String,
    #[serde(default)]
    name: Option<String>,
    credential: Value,
}

async fn passkey_register(State(st): State<AppState>, audit: Audit, headers: HeaderMap, AuthUser(user): AuthUser, Json(req): Json<PasskeyRegisterReq>) -> ApiResult<Json<Value>> {
    let invalid = || bad("passkey_invalid", "The passkey could not be verified");
    let Some(Challenge { kind: ChallengeKind::PasskeyRegister { user_id }, bytes, .. }) = st.challenges.take(&req.challenge_id) else {
        return Err(bad("challenge_expired", "The request expired. Try again."));
    };
    if user_id != user.id {
        return Err(invalid());
    }
    let (rp_id, origin) = relying_party(&headers);
    let parts = credential_parts(&req.credential, &["clientDataJSON", "attestationObject"]).ok_or_else(invalid)?;
    webauthn::check_client_data(&parts[0], "webauthn.create", &bytes, &origin).map_err(|e| {
        tracing::debug!("passkey registration: {e:#}");
        invalid()
    })?;
    let cred = webauthn::parse_attestation(&parts[1], &rp_id).map_err(|e| {
        tracing::debug!("passkey registration: {e:#}");
        bad("passkey_unsupported", "This passkey is not supported (an ES256 / P-256 key is required)")
    })?;
    let name = req.name.map(|n| n.trim().chars().take(40).collect::<String>()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Passkey".into());
    let (uid, n2) = (user.id, name.clone());
    let inserted = st
        .db
        .call(move |c| {
            let exists: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM passkeys WHERE cred_id = ?)", [&cred.id], |r| r.get(0))?;
            if exists {
                return Ok(false);
            }
            c.execute(
                "INSERT INTO passkeys (user_id, cred_id, public_key, sign_count, name, created_at) VALUES (?,?,?,?,?,?)",
                rusqlite::params![uid, cred.id, cred.public_key, cred.sign_count, n2, now_ms()],
            )?;
            Ok(true)
        })
        .await?;
    if !inserted {
        return Err(bad("passkey_exists", "This passkey is already registered"));
    }
    audit.log("auth.passkey_added", Some(("user", user.id, &user.username)), Some(json!({ "name": name })));
    Ok(Json(json!({})))
}

async fn list_passkeys(State(st): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let uid = user.id;
    let items = st
        .db
        .call(move |c| {
            let mut stmt = c.prepare("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at")?;
            let rows = stmt
                .query_map([uid], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)?, "created_at": r.get::<_, i64>(2)?, "last_used_at": r.get::<_, Option<i64>>(3)? })))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await?;
    Ok(Json(json!({ "items": items })))
}

async fn remove_passkey(State(st): State<AppState>, audit: Audit, AuthUser(user): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let uid = user.id;
    let name = st
        .db
        .call(move |c| {
            let name = c.query_row("SELECT name FROM passkeys WHERE id = ? AND user_id = ?", rusqlite::params![id, uid], |r| r.get::<_, String>(0)).optional()?;
            if name.is_some() {
                c.execute("DELETE FROM passkeys WHERE id = ?", [id])?;
            }
            Ok(name)
        })
        .await?
        .ok_or(ApiError::NotFound)?;
    audit.log("auth.passkey_removed", Some(("user", user.id, &user.username)), Some(json!({ "name": name })));
    Ok(Json(json!({})))
}

#[derive(Deserialize, Default)]
struct PasskeyLoginOptionsReq {
    username: Option<String>,
}

async fn passkey_login_options(State(st): State<AppState>, headers: HeaderMap, body: Option<Json<PasskeyLoginOptionsReq>>) -> ApiResult<Json<Value>> {
    let (rp_id, _) = relying_party(&headers);
    let username = body.and_then(|b| b.0.username).map(|u| u.trim().to_lowercase()).filter(|u| !u.is_empty());
    let allow: Vec<Vec<u8>> = match username {
        Some(u) => {
            st.db
                .call(move |c| {
                    let mut stmt = c.prepare("SELECT p.cred_id FROM passkeys p JOIN users u ON u.id = p.user_id WHERE u.username = ?")?;
                    Ok(stmt.query_map([u], |r| r.get::<_, Vec<u8>>(0))?.collect::<rusqlite::Result<_>>()?)
                })
                .await?
        }
        None => Vec::new(),
    };
    let mut challenge = vec![0u8; 32];
    rand::fill(&mut challenge[..]);
    let id = st.challenges.put(ChallengeKind::PasskeyLogin, challenge.clone());
    Ok(Json(json!({
        "challenge_id": id,
        "publicKey": {
            "challenge": webauthn::b64_encode(&challenge),
            "rpId": rp_id,
            "timeout": 120_000,
            "userVerification": "required",
            "allowCredentials": allow.iter().map(|c| json!({ "type": "public-key", "id": webauthn::b64_encode(c) })).collect::<Vec<_>>(),
        }
    })))
}

#[derive(Deserialize)]
struct PasskeyLoginReq {
    challenge_id: String,
    credential: Value,
}

async fn passkey_login(State(st): State<AppState>, audit: Audit, headers: HeaderMap, Json(req): Json<PasskeyLoginReq>) -> ApiResult<Response> {
    let ip_key = format!("passkey:{}", client_ip(&headers));
    if st.throttle.blocked(&ip_key) {
        audit.log_always("auth.login_blocked", None, Some(json!({ "method": "passkey" })));
        return Err(ApiError::TooMany);
    }
    let fail = |why: &'static str| {
        st.throttle.fail(&ip_key);
        audit.log_always("auth.login_failed", None, Some(json!({ "method": "passkey", "reason": why })));
        bad("passkey_invalid", "The passkey could not be verified")
    };
    let Some(Challenge { kind: ChallengeKind::PasskeyLogin, bytes, .. }) = st.challenges.take(&req.challenge_id) else {
        return Err(bad("challenge_expired", "The request expired. Try again."));
    };
    let (rp_id, origin) = relying_party(&headers);
    let cred_id = req.credential["rawId"].as_str().or(req.credential["id"].as_str()).and_then(|s| webauthn::b64_decode(s).ok()).ok_or_else(|| fail("no credential id"))?;
    let parts = credential_parts(&req.credential, &["clientDataJSON", "authenticatorData", "signature"]).ok_or_else(|| fail("malformed"))?;
    let user_handle_bytes = req.credential["response"]["userHandle"].as_str().and_then(|s| webauthn::b64_decode(s).ok()).filter(|v| !v.is_empty());
    webauthn::check_client_data(&parts[0], "webauthn.get", &bytes, &origin).map_err(|_| fail("client data"))?;

    let cid = cred_id.clone();
    let row = st
        .db
        .call(move |c| {
            Ok(c.query_row("SELECT id, user_id, public_key, sign_count FROM passkeys WHERE cred_id = ?", [cid], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, Vec<u8>>(2)?, r.get::<_, i64>(3)?))
            })
            .optional()?)
        })
        .await?;
    let Some((pk_id, uid, public_key, stored_count)) = row else { return Err(fail("unknown credential")) };
    if user_handle_bytes.as_deref().is_some_and(|h| h != uid.to_be_bytes()) {
        return Err(fail("user handle mismatch"));
    }
    let assertion = webauthn::verify_assertion(&public_key, &rp_id, &parts[1], &parts[0], &parts[2]).map_err(|e| {
        tracing::debug!("passkey login: {e:#}");
        fail("signature")
    })?;
    // A counter that does not move forward hints at a cloned authenticator
    // (many platform authenticators always report 0, which is fine).
    let new_count = assertion.sign_count as i64;
    if (stored_count > 0 || new_count > 0) && new_count <= stored_count {
        return Err(fail("counter"));
    }
    st.db
        .call(move |c| {
            c.execute("UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?", rusqlite::params![new_count, now_ms(), pk_id])?;
            Ok(())
        })
        .await?;
    st.throttle.clear(&ip_key);
    start_session(&st, &audit, &headers, uid, "passkey", json!({ "method": "passkey" })).await
}

// ---------- API tokens ----------

async fn list_tokens(State(st): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let uid = user.id;
    let items = st
        .db
        .call(move |c| {
            let mut stmt = c.prepare("SELECT id, name, prefix, scope, created_at, last_used_at, expires_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC")?;
            let rows = stmt
                .query_map([uid], |r| {
                    Ok(json!({
                        "id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)?, "prefix": r.get::<_, String>(2)?,
                        "scope": r.get::<_, String>(3)?, "created_at": r.get::<_, i64>(4)?,
                        "last_used_at": r.get::<_, Option<i64>>(5)?, "expires_at": r.get::<_, Option<i64>>(6)?,
                    }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await?;
    Ok(Json(json!({ "items": items })))
}

#[derive(Deserialize)]
struct TokenReq {
    name: String,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    expires_days: Option<i64>,
}

async fn create_token(State(st): State<AppState>, audit: Audit, AuthUser(user): AuthUser, Json(req): Json<TokenReq>) -> ApiResult<Json<Value>> {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(bad("name_required", "Name is required"));
    }
    if name.chars().count() > 60 {
        return Err(bad("name_too_long", "Name is too long"));
    }
    let scope = match req.scope.as_deref() {
        None | Some("write") => "write",
        Some("read") => "read",
        _ => return Err(bad("token_scope_invalid", "Choose read or write access")),
    };
    let token = format!("obs_{}", auth::random_hex(24));
    let prefix: String = token.chars().take(10).collect();
    let expires_at = req.expires_days.map(|d| now_ms() + d.clamp(1, 3650) * 86_400_000);
    let (uid, th, n2, p2) = (user.id, auth::api_token_hash(&token), name.clone(), prefix.clone());
    let id = st
        .db
        .call(move |c| {
            c.execute(
                "INSERT INTO api_tokens (user_id, name, token_hash, prefix, scope, created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
                rusqlite::params![uid, n2, th, p2, scope, now_ms(), expires_at],
            )?;
            Ok(c.last_insert_rowid())
        })
        .await?;
    audit.log("token.create", Some(("token", id, &name)), Some(json!({ "scope": scope, "expires_at": expires_at })));
    Ok(Json(json!({ "token": token, "item": { "id": id, "name": name, "prefix": prefix, "scope": scope, "created_at": now_ms(), "last_used_at": null, "expires_at": expires_at } })))
}

async fn delete_token(State(st): State<AppState>, audit: Audit, AuthUser(user): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let uid = user.id;
    let name = st
        .db
        .call(move |c| {
            let name = c.query_row("SELECT name FROM api_tokens WHERE id = ? AND user_id = ?", rusqlite::params![id, uid], |r| r.get::<_, String>(0)).optional()?;
            if name.is_some() {
                c.execute("DELETE FROM api_tokens WHERE id = ?", [id])?;
            }
            Ok(name)
        })
        .await?
        .ok_or(ApiError::NotFound)?;
    audit.log("token.revoke", Some(("token", id, &name)), None);
    Ok(Json(json!({})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_labels() {
        assert_eq!(device_label("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"), "Chrome · macOS");
        assert_eq!(device_label("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari · iOS");
        assert_eq!(device_label("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge · Windows");
        assert_eq!(device_label("curl/8.4.0"), "curl");
        assert_eq!(device_label(""), "Unknown");
    }

    #[test]
    fn challenges_expire_and_are_single_use() {
        let c = Challenges::default();
        let id = c.put(ChallengeKind::PasskeyLogin, vec![1]);
        assert!(c.take(&id).is_some());
        assert!(c.take(&id).is_none());
        let id = c.put(ChallengeKind::TwoFactor { user_id: 1, attempts: 0 }, vec![]);
        for _ in 0..4 {
            c.two_factor_failed(&id);
            assert_eq!(c.two_factor_user(&id), Some(1));
        }
        c.two_factor_failed(&id);
        assert_eq!(c.two_factor_user(&id), None, "five failures burn the challenge");
    }

    #[test]
    fn relying_party_from_headers() {
        let mut h = HeaderMap::new();
        h.insert(header::HOST, "status.example.com".parse().unwrap());
        h.insert("x-forwarded-proto", "https".parse().unwrap());
        assert_eq!(relying_party(&h), ("status.example.com".into(), "https://status.example.com".into()));
        let mut h = HeaderMap::new();
        h.insert(header::HOST, "localhost:3001".parse().unwrap());
        assert_eq!(relying_party(&h), ("localhost".into(), "http://localhost:3001".into()));
    }
}
