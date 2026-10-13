use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::db::now_ms;

/// Validation failure: a stable machine code plus an English message.
#[derive(Debug)]
pub struct Invalid(pub &'static str, pub &'static str);

impl std::fmt::Display for Invalid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.1)
    }
}

impl std::error::Error for Invalid {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Superadmin,
    User,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Superadmin => "superadmin",
            Role::User => "user",
        }
    }
    pub fn parse(s: &str) -> Role {
        if s == "superadmin" { Role::Superadmin } else { Role::User }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub name: String,
    pub role: Role,
}

impl User {
    pub fn is_admin(&self) -> bool {
        self.role == Role::Superadmin
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MonitorType {
    Http,
    Keyword,
    Tcp,
}

impl MonitorType {
    fn as_str(self) -> &'static str {
        match self {
            MonitorType::Http => "http",
            MonitorType::Keyword => "keyword",
            MonitorType::Tcp => "tcp",
        }
    }
    fn parse(s: &str) -> MonitorType {
        match s {
            "keyword" => MonitorType::Keyword,
            "tcp" => MonitorType::Tcp,
            _ => MonitorType::Http,
        }
    }
}

fn default_method() -> String {
    "GET".into()
}
fn default_interval() -> u32 {
    60
}
fn default_retries() -> u32 {
    2
}
fn default_timeout() -> u32 {
    30
}
fn default_status() -> String {
    "200-299".into()
}
fn default_redirects() -> u32 {
    10
}

/// Editable monitor configuration (what the API accepts).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorConfig {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: MonitorType,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub keyword: Option<String>,
    #[serde(default)]
    pub invert_keyword: bool,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default = "default_interval")]
    pub interval: u32,
    #[serde(default = "default_interval")]
    pub retry_interval: u32,
    #[serde(default = "default_retries")]
    pub max_retries: u32,
    #[serde(default = "default_timeout")]
    pub timeout: u32,
    #[serde(default = "default_status")]
    pub accepted_status: String,
    #[serde(default)]
    pub ignore_tls: bool,
    #[serde(default)]
    pub upside_down: bool,
    #[serde(default = "default_redirects")]
    pub max_redirects: u32,
    #[serde(default)]
    pub headers: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub group_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Monitor {
    pub id: i64,
    pub active: bool,
    #[serde(flatten)]
    pub cfg: MonitorConfig,
}

fn empty_to_none(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

impl MonitorConfig {
    /// Normalise and validate user input.
    pub fn validate(mut self) -> Result<Self, Invalid> {
        self.name = self.name.trim().to_string();
        if self.name.is_empty() {
            return Err(Invalid("name_required", "Name is required"));
        }
        self.url = empty_to_none(self.url);
        self.keyword = empty_to_none(self.keyword);
        self.hostname = empty_to_none(self.hostname);
        self.headers = empty_to_none(self.headers);
        self.body = empty_to_none(self.body);
        self.description = empty_to_none(self.description);
        self.method = self.method.trim().to_uppercase();
        if self.method.is_empty() {
            self.method = "GET".into();
        }
        match self.kind {
            MonitorType::Http | MonitorType::Keyword => {
                let Some(url) = &self.url else { return Err(Invalid("url_required", "URL is required")) };
                if !(url.starts_with("http://") || url.starts_with("https://")) {
                    return Err(Invalid("url_scheme", "URL must start with http:// or https://"));
                }
                if self.kind == MonitorType::Keyword && self.keyword.is_none() {
                    return Err(Invalid("keyword_required", "Keyword is required"));
                }
            }
            MonitorType::Tcp => {
                if self.hostname.is_none() || self.port.unwrap_or(0) == 0 {
                    return Err(Invalid("host_port_required", "Host and port are required"));
                }
            }
        }
        if let Some(h) = &self.headers {
            let v: serde_json::Value =
                serde_json::from_str(h).map_err(|_| Invalid("headers_invalid_json", "Headers must be valid JSON"))?;
            if !v.is_object() {
                return Err(Invalid("headers_not_object", "Headers must be a JSON object"));
            }
        }
        if parse_status_ranges(&self.accepted_status).is_empty() {
            return Err(Invalid("accepted_status_invalid", "Accepted status codes are invalid"));
        }
        self.interval = self.interval.clamp(20, 86_400);
        self.retry_interval = self.retry_interval.clamp(20, 86_400);
        self.timeout = self.timeout.clamp(1, 120);
        self.max_retries = self.max_retries.min(20);
        self.max_redirects = self.max_redirects.min(30);
        Ok(self)
    }
}

/// Parses "200-299,301" into inclusive ranges.
pub fn parse_status_ranges(s: &str) -> Vec<(u16, u16)> {
    s.split(',')
        .filter_map(|part| {
            let part = part.trim();
            if part.is_empty() {
                return None;
            }
            match part.split_once('-') {
                Some((a, b)) => Some((a.trim().parse().ok()?, b.trim().parse().ok()?)),
                None => {
                    let v = part.parse().ok()?;
                    Some((v, v))
                }
            }
        })
        .collect()
}

const MONITOR_COLS: &str = "id, active, name, type, url, method, keyword, invert_keyword, hostname, port, \
     interval, retry_interval, max_retries, timeout, accepted_status, ignore_tls, upside_down, \
     max_redirects, headers, body, description, group_id";

fn monitor_from_row(r: &Row) -> rusqlite::Result<Monitor> {
    Ok(Monitor {
        id: r.get(0)?,
        active: r.get(1)?,
        cfg: MonitorConfig {
            name: r.get(2)?,
            kind: MonitorType::parse(&r.get::<_, String>(3)?),
            url: r.get(4)?,
            method: r.get(5)?,
            keyword: r.get(6)?,
            invert_keyword: r.get(7)?,
            hostname: r.get(8)?,
            port: r.get(9)?,
            interval: r.get(10)?,
            retry_interval: r.get(11)?,
            max_retries: r.get(12)?,
            timeout: r.get(13)?,
            accepted_status: r.get(14)?,
            ignore_tls: r.get(15)?,
            upside_down: r.get(16)?,
            max_redirects: r.get(17)?,
            headers: r.get(18)?,
            body: r.get(19)?,
            description: r.get(20)?,
            group_id: r.get(21)?,
        },
    })
}

pub fn list_monitors(c: &Connection) -> Result<Vec<Monitor>> {
    let mut st = c.prepare_cached(&format!("SELECT {MONITOR_COLS} FROM monitors ORDER BY name COLLATE NOCASE"))?;
    let rows = st.query_map([], monitor_from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_monitor(c: &Connection, id: i64) -> Result<Option<Monitor>> {
    let mut st = c.prepare_cached(&format!("SELECT {MONITOR_COLS} FROM monitors WHERE id = ?"))?;
    Ok(st.query_row([id], monitor_from_row).optional()?)
}

pub fn insert_monitor(c: &Connection, m: &MonitorConfig, active: bool) -> Result<i64> {
    c.execute(
        "INSERT INTO monitors (name, type, url, method, keyword, invert_keyword, hostname, port, interval, \
         retry_interval, max_retries, timeout, accepted_status, ignore_tls, upside_down, max_redirects, \
         headers, body, description, group_id, active, created_at) \
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM groups WHERE id = ?),?,?)",
        params![
            m.name, m.kind.as_str(), m.url, m.method, m.keyword, m.invert_keyword, m.hostname, m.port,
            m.interval, m.retry_interval, m.max_retries, m.timeout, m.accepted_status, m.ignore_tls,
            m.upside_down, m.max_redirects, m.headers, m.body, m.description, m.group_id, active,
            now_ms()
        ],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn update_monitor(c: &Connection, id: i64, m: &MonitorConfig) -> Result<bool> {
    let n = c.execute(
        "UPDATE monitors SET name=?, type=?, url=?, method=?, keyword=?, invert_keyword=?, hostname=?, \
         port=?, interval=?, retry_interval=?, max_retries=?, timeout=?, accepted_status=?, ignore_tls=?, \
         upside_down=?, max_redirects=?, headers=?, body=?, description=?, \
         group_id=(SELECT id FROM groups WHERE id = ?) WHERE id=?",
        params![
            m.name, m.kind.as_str(), m.url, m.method, m.keyword, m.invert_keyword, m.hostname, m.port,
            m.interval, m.retry_interval, m.max_retries, m.timeout, m.accepted_status, m.ignore_tls,
            m.upside_down, m.max_redirects, m.headers, m.body, m.description, m.group_id, id
        ],
    )?;
    Ok(n > 0)
}

pub fn set_monitor_notifications(c: &Connection, monitor_id: i64, ids: &[i64]) -> Result<()> {
    c.execute("DELETE FROM monitor_notifications WHERE monitor_id = ?", [monitor_id])?;
    let mut st = c.prepare_cached(
        "INSERT OR IGNORE INTO monitor_notifications (monitor_id, notification_id) \
         SELECT ?, id FROM notifications WHERE id = ?",
    )?;
    for id in ids {
        st.execute([monitor_id, *id])?;
    }
    Ok(())
}

pub fn monitor_notification_ids(c: &Connection, monitor_id: i64) -> Result<Vec<i64>> {
    let mut st = c.prepare_cached("SELECT notification_id FROM monitor_notifications WHERE monitor_id = ?")?;
    let ids = st.query_map([monitor_id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

fn ids(c: &Connection, sql: &str, id: i64) -> Result<Vec<i64>> {
    let mut st = c.prepare_cached(sql)?;
    let ids = st.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

/// Monitor ids directly assigned to a user (not via groups).
pub fn user_monitor_ids(c: &Connection, user_id: i64) -> Result<Vec<i64>> {
    ids(c, "SELECT monitor_id FROM user_monitors WHERE user_id = ?", user_id)
}

pub fn user_group_ids(c: &Connection, user_id: i64) -> Result<Vec<i64>> {
    ids(c, "SELECT group_id FROM user_groups WHERE user_id = ?", user_id)
}

/// Every monitor id a non-admin user may see: direct grants plus group members.
pub fn user_visible_ids(c: &Connection, user_id: i64) -> Result<Vec<i64>> {
    let mut st = c.prepare_cached(
        "SELECT monitor_id FROM user_monitors WHERE user_id = ?1 \
         UNION SELECT m.id FROM monitors m JOIN user_groups ug ON ug.group_id = m.group_id WHERE ug.user_id = ?1",
    )?;
    let ids = st.query_map([user_id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

pub fn set_user_groups(c: &Connection, user_id: i64, ids: &[i64]) -> Result<()> {
    c.execute("DELETE FROM user_groups WHERE user_id = ?", [user_id])?;
    let mut st = c.prepare_cached(
        "INSERT OR IGNORE INTO user_groups (user_id, group_id) SELECT ?, id FROM groups WHERE id = ?",
    )?;
    for id in ids {
        st.execute([user_id, *id])?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub monitor_ids: Vec<i64>,
}

pub fn list_groups(c: &Connection) -> Result<Vec<Group>> {
    let mut st = c.prepare_cached("SELECT id, name FROM groups ORDER BY name COLLATE NOCASE")?;
    let rows = st
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(id, name)| {
            let monitor_ids = ids(c, "SELECT id FROM monitors WHERE group_id = ? ORDER BY name COLLATE NOCASE", id)?;
            Ok(Group { id, name, monitor_ids })
        })
        .collect()
}

/// Replace a group's membership: listed monitors move into it, others leave it.
pub fn set_group_monitors(c: &Connection, group_id: i64, monitor_ids: &[i64]) -> Result<()> {
    c.execute("UPDATE monitors SET group_id = NULL WHERE group_id = ?", [group_id])?;
    let mut st = c.prepare_cached("UPDATE monitors SET group_id = ? WHERE id = ?")?;
    for id in monitor_ids {
        st.execute([group_id, *id])?;
    }
    Ok(())
}

pub fn set_user_monitors(c: &Connection, user_id: i64, ids: &[i64]) -> Result<()> {
    c.execute("DELETE FROM user_monitors WHERE user_id = ?", [user_id])?;
    let mut st = c.prepare_cached(
        "INSERT OR IGNORE INTO user_monitors (user_id, monitor_id) SELECT ?, id FROM monitors WHERE id = ?",
    )?;
    for id in ids {
        st.execute([user_id, *id])?;
    }
    Ok(())
}

pub fn get_setting(c: &Connection, key: &str) -> Result<Option<String>> {
    Ok(c.query_row("SELECT value FROM settings WHERE key = ?", [key], |r| r.get(0)).optional()?)
}

pub fn set_setting(c: &Connection, key: &str, value: &str) -> Result<()> {
    c.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(kind: MonitorType) -> MonitorConfig {
        MonitorConfig {
            name: " Site ".into(),
            kind,
            url: Some("https://example.com".into()),
            method: "get".into(),
            keyword: None,
            invert_keyword: false,
            hostname: None,
            port: None,
            interval: 5,
            retry_interval: 60,
            max_retries: 2,
            timeout: 30,
            accepted_status: "200-299".into(),
            ignore_tls: false,
            upside_down: false,
            max_redirects: 10,
            headers: None,
            body: None,
            description: None,
            group_id: None,
        }
    }

    #[test]
    fn status_ranges() {
        assert_eq!(parse_status_ranges("200-299, 301"), vec![(200, 299), (301, 301)]);
        assert!(parse_status_ranges("abc").is_empty());
        assert!(parse_status_ranges("").is_empty());
    }

    #[test]
    fn validate_normalises() {
        let c = cfg(MonitorType::Http).validate().unwrap();
        assert_eq!(c.name, "Site");
        assert_eq!(c.method, "GET");
        assert_eq!(c.interval, 20, "interval is clamped to the 20 s minimum");
    }

    #[test]
    fn validate_rejects_bad_input() {
        let mut c = cfg(MonitorType::Http);
        c.url = Some("ftp://x".into());
        assert_eq!(c.validate().unwrap_err().0, "url_scheme");

        assert_eq!(cfg(MonitorType::Keyword).validate().unwrap_err().0, "keyword_required");
        assert_eq!(cfg(MonitorType::Tcp).validate().unwrap_err().0, "host_port_required");

        let mut c = cfg(MonitorType::Http);
        c.headers = Some("[1]".into());
        assert_eq!(c.validate().unwrap_err().0, "headers_not_object");

        let mut c = cfg(MonitorType::Http);
        c.accepted_status = "nope".into();
        assert_eq!(c.validate().unwrap_err().0, "accepted_status_invalid");
    }
}
