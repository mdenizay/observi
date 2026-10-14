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

pub fn create_session(c: &Connection, user_id: i64) -> Result<String> {
    let token = random_hex(32);
    let now = now_ms();
    c.execute("DELETE FROM sessions WHERE expires_at < ?", [now])?;
    c.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        rusqlite::params![token_hash(&token), user_id, now + SESSION_TTL_MS],
    )?;
    Ok(token)
}

pub fn delete_session(c: &Connection, token: &str) -> Result<()> {
    c.execute("DELETE FROM sessions WHERE token_hash = ?", [token_hash(token)])?;
    Ok(())
}

pub fn session_user(c: &Connection, token: &str) -> Result<Option<User>> {
    Ok(c
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
        .optional()?)
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
