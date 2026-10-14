use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::Result;
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::api::ApiError;
use crate::db::now_ms;
use crate::models::{Role, User};
use crate::state::AppState;

pub const COOKIE: &str = "observi_session";
pub const SESSION_TTL_MS: i64 = 30 * 24 * 3600 * 1000;

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::fill(&mut buf[..]);
    hex::encode(buf)
}

pub fn hash_password(password: &str) -> Result<String> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hash: {e}"))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    Argon2::default().verify_password(password.as_bytes(), hash).is_ok()
}

/// Burn the same CPU time as a real verification when the user doesn't exist,
/// so response timing doesn't reveal which usernames are valid.
pub fn dummy_verify(password: &str) {
    static DUMMY: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    let hash = DUMMY.get_or_init(|| hash_password("observi-dummy-password").unwrap_or_default());
    verify_password(password, hash);
}

fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// Where and how a session was started.
pub struct SessionMeta {
    pub ip: String,
    pub user_agent: String,
    /// "password", "password+2fa", "recovery" or "passkey".
    pub method: &'static str,
}

impl SessionMeta {
    pub fn from_headers(headers: &axum::http::HeaderMap, method: &'static str) -> Self {
        let user_agent = headers
            .get(axum::http::header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .chars()
            .take(300)
            .collect();
        SessionMeta { ip: crate::audit::client_ip(headers), user_agent, method }
    }
}

/// Public identifier of a session (a prefix of its token hash; safe to show and
/// useless for authenticating).
pub fn session_public_id(token: &str) -> String {
    token_hash(token)[..16].to_string()
}

pub fn create_session(c: &Connection, user_id: i64, meta: &SessionMeta) -> Result<String> {
    let token = random_hex(32);
    let now = now_ms();
    c.execute("DELETE FROM sessions WHERE expires_at < ?", [now])?;
    c.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at, ip, user_agent, method) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![token_hash(&token), user_id, now + SESSION_TTL_MS, now, now, meta.ip, meta.user_agent, meta.method],
    )?;
    Ok(token)
}

pub fn delete_session(c: &Connection, token: &str) -> Result<()> {
    c.execute("DELETE FROM sessions WHERE token_hash = ?", [token_hash(token)])?;
    Ok(())
}

pub fn session_user(c: &Connection, token: &str) -> Result<Option<User>> {
    let user = c
        .query_row(
            "SELECT u.id, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id \
             WHERE s.token_hash = ? AND s.expires_at > ?",
            rusqlite::params![token_hash(token), now_ms()],
            |r| {
                Ok(User {
                    id: r.get(0)?,
                    username: r.get(1)?,
                    name: r.get(2)?,
                    role: Role::parse(&r.get::<_, String>(3)?),
                })
            },
        )
        .optional()?;
    if user.is_some() {
        // Keep "last active" fresh without writing on every request.
        let now = now_ms();
        c.execute(
            "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND last_seen_at < ?",
            rusqlite::params![now, token_hash(token), now - 60_000],
        )?;
    }
    Ok(user)
}

pub enum TokenAuth {
    Ok(User),
    ReadOnly,
    Invalid,
}

pub fn api_token_hash(token: &str) -> String {
    token_hash(token)
}

/// Authenticate an `obs_…` API token; read-only tokens only pass for safe methods.
pub fn token_user(c: &Connection, token: &str, method: &axum::http::Method) -> Result<TokenAuth> {
    let now = now_ms();
    let row = c
        .query_row(
            "SELECT t.id, t.scope, t.expires_at, t.last_used_at, u.id, u.username, u.name, u.role \
             FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?",
            [token_hash(token)],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    User {
                        id: r.get(4)?,
                        username: r.get(5)?,
                        name: r.get(6)?,
                        role: Role::parse(&r.get::<_, String>(7)?),
                    },
                ))
            },
        )
        .optional()?;
    let Some((id, scope, expires_at, last_used, user)) = row else { return Ok(TokenAuth::Invalid) };
    if expires_at.is_some_and(|e| e <= now) {
        return Ok(TokenAuth::Invalid);
    }
    let safe = matches!(*method, axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS);
    if scope == "read" && !safe {
        return Ok(TokenAuth::ReadOnly);
    }
    if last_used.is_none_or(|l| now - l > 60_000) {
        c.execute("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", rusqlite::params![now, id])?;
    }
    Ok(TokenAuth::Ok(user))
}

pub fn create_user(c: &Connection, username: &str, name: &str, password: &str, role: Role) -> Result<i64> {
    c.execute(
        "INSERT INTO users (username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params![username, name, hash_password(password)?, role.as_str(), now_ms()],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn cookie_value(parts: &Parts, name: &str) -> Option<String> {
    parts
        .headers
        .get_all(axum::http::header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

/// Any logged-in user.
pub struct AuthUser(pub User);

/// Logged-in superadmin.
pub struct Admin(pub User);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        // API tokens: `Authorization: Bearer obs_…`
        if let Some(bearer) = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| t.starts_with("obs_"))
        {
            let (token, method) = (bearer.to_string(), parts.method.clone());
            return match state.db.call(move |c| token_user(c, &token, &method)).await? {
                TokenAuth::Ok(user) => {
                    crate::audit::note_actor(parts, &user);
                    Ok(AuthUser(user))
                }
                TokenAuth::ReadOnly => Err(ApiError::Bad("token_read_only", "This API token is read-only".into())),
                TokenAuth::Invalid => Err(ApiError::Unauthorized),
            };
        }
        let token = cookie_value(parts, COOKIE).ok_or(ApiError::Unauthorized)?;
        let user = state
            .db
            .call(move |c| session_user(c, &token))
            .await?
            .ok_or(ApiError::Unauthorized)?;
        crate::audit::note_actor(parts, &user);
        Ok(AuthUser(user))
    }
}

impl FromRequestParts<AppState> for Admin {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let AuthUser(user) = AuthUser::from_request_parts(parts, state).await?;
        if !user.is_admin() {
            return Err(ApiError::Forbidden);
        }
        Ok(Admin(user))
    }
}

/// Simple brute-force protection: after `MAX_FAILS` failures for a key within
/// the window, further attempts are rejected until the window expires.
#[derive(Default)]
pub struct LoginThrottle(Mutex<HashMap<String, (u32, Instant)>>);

const MAX_FAILS: u32 = 8;
const WINDOW: Duration = Duration::from_secs(15 * 60);

impl LoginThrottle {
    pub fn blocked(&self, key: &str) -> bool {
        let map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        matches!(map.get(key), Some((n, at)) if *n >= MAX_FAILS && at.elapsed() < WINDOW)
    }

    pub fn fail(&self, key: &str) {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, (_, at)| at.elapsed() < WINDOW);
        let e = map.entry(key.to_string()).or_insert((0, Instant::now()));
        e.0 += 1;
        e.1 = Instant::now();
    }

    pub fn clear(&self, key: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_roundtrip() {
        let hash = hash_password("correct horse").unwrap();
        assert!(verify_password("correct horse", &hash));
        assert!(!verify_password("wrong", &hash));
        assert!(!verify_password("x", "not-a-hash"));
    }

    #[test]
    fn throttle_blocks_after_repeated_failures() {
        let t = LoginThrottle::default();
        for _ in 0..MAX_FAILS {
            assert!(!t.blocked("k"));
            t.fail("k");
        }
        assert!(t.blocked("k"));
        t.clear("k");
        assert!(!t.blocked("k"));
    }
}
