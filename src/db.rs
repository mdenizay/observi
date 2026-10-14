use std::sync::{Arc, Mutex};

use anyhow::Result;
use rusqlite::Connection;

/// Single SQLite connection guarded by a mutex. Every call runs on the
/// blocking pool so the async runtime never stalls on disk I/O.
#[derive(Clone)]
pub struct Db(Arc<Mutex<Connection>>);

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('superadmin','user')),
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    url TEXT,
    method TEXT NOT NULL DEFAULT 'GET',
    keyword TEXT,
    invert_keyword INTEGER NOT NULL DEFAULT 0,
    hostname TEXT,
    port INTEGER,
    interval INTEGER NOT NULL DEFAULT 60,
    retry_interval INTEGER NOT NULL DEFAULT 60,
    max_retries INTEGER NOT NULL DEFAULT 2,
    timeout INTEGER NOT NULL DEFAULT 30,
    accepted_status TEXT NOT NULL DEFAULT '200-299',
    ignore_tls INTEGER NOT NULL DEFAULT 0,
    upside_down INTEGER NOT NULL DEFAULT 0,
    max_redirects INTEGER NOT NULL DEFAULT 10,
    headers TEXT,
    body TEXT,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_monitors (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, monitor_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    config TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS monitor_notifications (
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    PRIMARY KEY (monitor_id, notification_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS heartbeats (
    monitor_id INTEGER NOT NULL,
    t INTEGER NOT NULL,
    s INTEGER NOT NULL,
    l INTEGER,
    m TEXT,
    important INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (monitor_id, t)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS heartbeats_important ON heartbeats (monitor_id, t) WHERE important = 1;
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS branding_logo (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    t INTEGER NOT NULL,
    kind TEXT NOT NULL,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    monitor_name TEXT NOT NULL,
    data TEXT
);
CREATE INDEX IF NOT EXISTS activity_t ON activity (t);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    t INTEGER NOT NULL,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    target_name TEXT,
    ip TEXT,
    details TEXT
);
CREATE INDEX IF NOT EXISTS audit_t ON audit (t);
CREATE TABLE IF NOT EXISTS maintenance (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'maintenance',
    start_at INTEGER,
    end_at INTEGER,
    recur TEXT,
    all_monitors INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    disabled_until INTEGER
);
CREATE TABLE IF NOT EXISTS maintenance_monitors (
    maintenance_id INTEGER NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    PRIMARY KEY (maintenance_id, monitor_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS maintenance_groups (
    maintenance_id INTEGER NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (maintenance_id, group_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS monitor_tags (
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (monitor_id, tag_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS domains (
    domain TEXT PRIMARY KEY,
    expires_at INTEGER,
    registrar TEXT,
    checked_at INTEGER NOT NULL,
    alerted_level INTEGER NOT NULL DEFAULT 99,
    error TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT
);
CREATE TABLE IF NOT EXISTS user_totp (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_step INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_codes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at INTEGER
);
CREATE INDEX IF NOT EXISTS recovery_codes_user ON recovery_codes (user_id);
CREATE TABLE IF NOT EXISTS passkeys (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cred_id BLOB NOT NULL UNIQUE,
    public_key BLOB NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'write',
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS user_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS certs (
    monitor_id INTEGER PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    issuer TEXT,
    checked_at INTEGER NOT NULL,
    alerted_level INTEGER NOT NULL DEFAULT 99
);
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_groups (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
) WITHOUT ROWID;
"#;

impl Db {
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA temp_store = MEMORY;
             PRAGMA cache_size = -8000;",
        )?;
        conn.execute_batch(SCHEMA)?;
        migrate(&conn)?;
        Ok(Db(Arc::new(Mutex::new(conn))))
    }

    /// Run a closure against the connection on the blocking thread pool.
    pub async fn call<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Connection) -> Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let db = self.0.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = db.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut conn)
        })
        .await?
    }

    /// Synchronous access, for CLI commands that run before the server starts.
    pub fn blocking<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut conn = self.0.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut conn)
    }
}

/// Additive column migrations for databases created by older versions.
fn migrate(conn: &Connection) -> Result<()> {
    let has_group: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('monitors') WHERE name = 'group_id')",
        [],
        |r| r.get(0),
    )?;
    if !has_group {
        conn.execute_batch(
            "ALTER TABLE monitors ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL;",
        )?;
    }
    let has_digest: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('notifications') WHERE name = 'digest')",
        [],
        |r| r.get(0),
    )?;
    if !has_digest {
        conn.execute_batch("ALTER TABLE notifications ADD COLUMN digest INTEGER NOT NULL DEFAULT 1;")?;
    }
    for (col, ddl) in [
        ("created_at", "ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0"),
        ("last_seen_at", "ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0"),
        ("ip", "ALTER TABLE sessions ADD COLUMN ip TEXT"),
        ("user_agent", "ALTER TABLE sessions ADD COLUMN user_agent TEXT"),
        ("method", "ALTER TABLE sessions ADD COLUMN method TEXT"),
    ] {
        let has: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('sessions') WHERE name = ?)",
            [col],
            |r| r.get(0),
        )?;
        if !has {
            conn.execute_batch(ddl)?;
        }
    }
    crate::activity::backfill(conn)?;
    Ok(())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
