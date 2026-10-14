//! Domain registration expiry: look up when a monitored domain expires (RDAP,
//! falling back to WHOIS), show it in the UI and warn through the monitors'
//! notification channels before it lapses.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use rusqlite::Connection;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::api::ApiResult;
use crate::auth::{Admin, AuthUser};
use crate::db::now_ms;
use crate::models::{self, Monitor, MonitorType};
use crate::notify::{self, Alert};
use crate::state::AppState;

const DAY_MS: i64 = 86_400_000;
/// Days before expiry at which a warning goes out (and "expired" at 0).
const WARN_DAYS: [i64; 5] = [60, 30, 14, 7, 1];
const NO_ALERT: i64 = 99;
/// A domain counts as "expiring" in the UI within this many days.
const EXPIRING_DAYS: i64 = 30;

#[derive(Debug, Clone)]
pub struct DomainEntry {
    pub expires_at: Option<i64>,
    pub registrar: Option<String>,
    pub checked_at: i64,
    pub alerted_level: i64,
    pub error: Option<String>,
}

pub type Domains = HashMap<String, DomainEntry>;

impl DomainEntry {
    pub fn days_left(&self, now: i64) -> Option<i64> {
        self.expires_at.map(|e| (e - now).div_euclid(DAY_MS))
    }

    pub fn status(&self, now: i64) -> &'static str {
        match self.expires_at {
            None => "unknown",
            Some(e) if e <= now => "expired",
            Some(_) if self.days_left(now).unwrap_or(0) <= EXPIRING_DAYS => "expiring",
            Some(_) => "ok",
        }
    }

    pub fn to_json(&self, name: &str, now: i64) -> Value {
        json!({
            "name": name,
            "expires_at": self.expires_at,
            "days_left": self.days_left(now),
            "status": self.status(now),
            "registrar": self.registrar,
            "checked_at": self.checked_at,
            "error": self.error,
        })
    }
}

// ---------- which domain does a monitor belong to ----------

/// Registrable domain ("example.com.tr") of a monitor's host, if it has one.
pub fn registrable(m: &Monitor) -> Option<String> {
    let host = match m.cfg.kind {
        MonitorType::Tcp => m.cfg.hostname.clone()?,
        _ => reqwest::Url::parse(m.cfg.url.as_deref()?).ok()?.host_str()?.to_string(),
    };
    let host = host.trim_end_matches('.').to_lowercase();
    if host.parse::<std::net::IpAddr>().is_ok() || !host.contains('.') {
        return None;
    }
    let d = psl::domain_str(&host)?;
    // Only suffixes that are actually registered (not private/unknown ones).
    psl::suffix(host.as_bytes()).filter(|s| s.is_known())?;
    Some(d.to_string())
}

// ---------- lookup ----------

pub struct Info {
    pub expires_at: i64,
    pub registrar: Option<String>,
}

type Bootstrap = Vec<(Vec<String>, String)>;

static BOOTSTRAP: Mutex<Option<(i64, Bootstrap)>> = Mutex::new(None);
static WHOIS_SERVERS: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

async fn rdap_base(http: &reqwest::Client, tld: &str) -> Result<Option<String>> {
    let cached = {
        let g = BOOTSTRAP.lock().unwrap_or_else(|e| e.into_inner());
        g.as_ref().filter(|(at, _)| now_ms() - at < DAY_MS).map(|(_, v)| v.clone())
    };
    let services = match cached {
        Some(s) => s,
        None => {
            let v: Value = http
                .get("https://data.iana.org/rdap/dns.json")
                .timeout(Duration::from_secs(20))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let list: Bootstrap = v["services"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|s| {
                            let tlds = s[0].as_array()?.iter().filter_map(|t| t.as_str().map(str::to_lowercase)).collect();
                            let url = s[1].as_array()?.first()?.as_str()?.to_string();
                            Some((tlds, url))
                        })
                        .collect()
                })
                .unwrap_or_default();
            *BOOTSTRAP.lock().unwrap_or_else(|e| e.into_inner()) = Some((now_ms(), list.clone()));
            list
        }
    };
    Ok(services.into_iter().find(|(tlds, _)| tlds.iter().any(|t| t == tld)).map(|(_, url)| url))
}

async fn rdap_lookup(http: &reqwest::Client, base: &str, domain: &str) -> Result<Info> {
    let url = format!("{}/domain/{domain}", base.trim_end_matches('/'));
    let resp = http.get(url).timeout(Duration::from_secs(20)).header("accept", "application/rdap+json").send().await?;
    if resp.status().as_u16() == 404 {
        bail!("domain not found");
    }
    let v: Value = resp.error_for_status()?.json().await.context("unexpected RDAP response")?;
    let expires_at = v["events"]
        .as_array()
        .and_then(|e| {
            e.iter().find(|e| e["eventAction"].as_str().is_some_and(|a| a.eq_ignore_ascii_case("expiration")))
        })
        .and_then(|e| e["eventDate"].as_str())
        .and_then(crate::update::parse_rfc3339)
        .context("no expiry date in the RDAP response")?;
    let registrar = v["entities"].as_array().and_then(|ents| {
        ents.iter()
            .find(|e| e["roles"].as_array().is_some_and(|r| r.iter().any(|x| x == "registrar")))
            .and_then(|e| e["vcardArray"][1].as_array())
            .and_then(|props| props.iter().find(|p| p[0] == "fn"))
            .and_then(|p| p[3].as_str())
            .map(str::to_string)
    });
    Ok(Info { expires_at, registrar })
}

async fn whois_query(server: &str, query: &str) -> Result<String> {
    let work = async {
        let mut s = tokio::net::TcpStream::connect((server, 43)).await?;
        s.write_all(format!("{query}\r\n").as_bytes()).await?;
        let mut buf = Vec::new();
        s.take(64 * 1024).read_to_end(&mut buf).await?;
        anyhow::Ok(String::from_utf8_lossy(&buf).to_string())
    };
    tokio::time::timeout(Duration::from_secs(20), work).await.context("WHOIS timeout")?
}

async fn whois_server(tld: &str) -> Result<Option<String>> {
    if let Some(v) = WHOIS_SERVERS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(tld).cloned()) {
        return Ok(v);
    }
    let text = whois_query("whois.iana.org", tld).await?;
    let server = text
        .lines()
        .find_map(|l| l.strip_prefix("whois:"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    WHOIS_SERVERS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(tld.to_string(), server.clone());
    Ok(server)
}

fn month(s: &str) -> Option<i64> {
    if let Ok(n) = s.parse::<i64>() {
        return (1..=12).contains(&n).then_some(n);
    }
    let m = s.get(..3)?.to_lowercase();
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        .iter()
        .position(|x| *x == m)
        .map(|i| i as i64 + 1)
}

/// Dates as WHOIS servers print them: 2027-06-11, 2027-Jun-11., 11-Jun-2027,
/// 2027.06.11, 11/06/2027, 20270611, with or without a time.
pub fn parse_date(raw: &str) -> Option<i64> {
    let value = raw.trim().trim_end_matches('.');
    let date = value.split(['T', ' ']).next()?.trim().trim_end_matches('.');
    if date.len() == 8 && date.chars().all(|c| c.is_ascii_digit()) {
        let (y, m, d) = (date[..4].parse().ok()?, date[4..6].parse().ok()?, date[6..8].parse().ok()?);
        return Some(crate::cert::unix_ms(y, m, d, 12, 0, 0));
    }
    let parts: Vec<&str> = date.split(['-', '.', '/']).collect();
    if parts.len() != 3 {
        return None;
    }
    let (y, m, d) = if parts[0].len() == 4 {
        (parts[0].parse().ok()?, month(parts[1])?, parts[2].get(..2).unwrap_or(parts[2]).parse().ok()?)
    } else if parts[2].len() >= 4 {
        (parts[2].get(..4)?.parse().ok()?, month(parts[1])?, parts[0].parse().ok()?)
    } else {
        return None;
    };
    ((1..=31).contains(&d) && (1900..=2200).contains(&y)).then(|| crate::cert::unix_ms(y, m, d, 12, 0, 0))
}

/// Pull the expiry date (and registrar, when present) out of a WHOIS reply.
pub fn parse_whois(text: &str) -> Result<Info> {
    let lower = text.to_lowercase();
    if ["no match", "not found", "no entries found", "no data found", "status: free", "domain not found"]
        .iter()
        .any(|p| lower.contains(p))
        && !lower.contains("expir")
    {
        bail!("domain not found");
    }
    let (mut expires_at, mut registrar, mut in_registrar_block) = (None, None, false);
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("** Registrar") {
            in_registrar_block = true;
            continue;
        }
        if line.starts_with("** ") && !line.starts_with("** Registrar") {
            in_registrar_block = false;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        let key: String = key.chars().filter(|c| *c != '.').collect::<String>().trim().to_lowercase();
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let is_expiry = (key.contains("expir") || key.contains("paid-till") || key.contains("renewal date"))
            && !key.contains("registrar abuse");
        if is_expiry && expires_at.is_none() {
            expires_at = parse_date(value);
        } else if registrar.is_none() && (key == "registrar" || key == "sponsoring registrar" || (in_registrar_block && key == "organization name")) {
            registrar = Some(value.to_string()).filter(|v| !v.starts_with("http"));
        }
    }
    Ok(Info {
        expires_at: expires_at.context("this domain extension does not publish an expiry date")?,
        registrar,
    })
}

pub async fn lookup(http: &reqwest::Client, domain: &str) -> Result<Info> {
    let tld = domain.rsplit('.').next().unwrap_or_default().to_lowercase();
    if let Ok(Some(base)) = rdap_base(http, &tld).await
        && let Ok(info) = rdap_lookup(http, &base, domain).await
    {
        return Ok(info);
    }
    let server = whois_server(&tld).await?.context("no RDAP or WHOIS service for this extension")?;
    let text = whois_query(&server, domain).await?;
    parse_whois(&text)
}

// ---------- persistence ----------

pub fn load(c: &Connection) -> Result<Domains> {
    let mut st = c.prepare("SELECT domain, expires_at, registrar, checked_at, alerted_level, error FROM domains")?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                DomainEntry { expires_at: r.get(1)?, registrar: r.get(2)?, checked_at: r.get(3)?, alerted_level: r.get(4)?, error: r.get(5)? },
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn save(c: &Connection, domain: &str, e: &DomainEntry) -> Result<()> {
    c.execute(
        "INSERT INTO domains (domain, expires_at, registrar, checked_at, alerted_level, error) VALUES (?,?,?,?,?,?) \
         ON CONFLICT(domain) DO UPDATE SET expires_at = excluded.expires_at, registrar = excluded.registrar, \
         checked_at = excluded.checked_at, alerted_level = excluded.alerted_level, error = excluded.error",
        rusqlite::params![domain, e.expires_at, e.registrar, e.checked_at, e.alerted_level, e.error],
    )?;
    Ok(())
}

// ---------- alerts ----------

#[derive(Debug, PartialEq, Eq)]
enum Notice {
    Expiring(i64),
    Expired,
    Renewed,
}

fn level_for(expires_at: i64, now: i64) -> i64 {
    if expires_at <= now {
        return 0;
    }
    let days = (expires_at - now).div_euclid(DAY_MS);
    WARN_DAYS.iter().rev().find(|d| days <= **d).copied().unwrap_or(NO_ALERT)
}

fn evaluate(prev: Option<&DomainEntry>, entry: &mut DomainEntry, now: i64) -> Option<Notice> {
    let expires = entry.expires_at?;
    let mut alerted = prev.map(|p| p.alerted_level).unwrap_or(NO_ALERT);
    let mut notice = None;
    if let Some(p) = prev.and_then(|p| p.expires_at)
        && expires > p + 30 * DAY_MS
    {
        if alerted < NO_ALERT {
            notice = Some(Notice::Renewed);
        }
        alerted = NO_ALERT;
    }
    let level = level_for(expires, now);
    if level < alerted {
        notice = Some(if level == 0 { Notice::Expired } else { Notice::Expiring((expires - now).div_euclid(DAY_MS).max(0)) });
        alerted = level;
    }
    entry.alerted_level = alerted;
    notice
}

async fn announce(state: &AppState, domain: &str, entry: &DomainEntry, monitors: &[&Monitor], notice: Notice) {
    use crate::i18n::pick;
    let Some(expires) = entry.expires_at else { return };
    let date = crate::cert::ymd(expires);
    let registrar = entry.registrar.as_deref().map(|r| format!(" ({r})")).unwrap_or_default();
    let used_by = monitors.iter().map(|m| m.cfg.name.as_str()).collect::<Vec<_>>().join(", ");
    let en = pick("en", "tr") == "en";
    let (kind, title, body, up) = match notice {
        Notice::Expiring(days) => {
            let n = days.max(1);
            (
                "domain_expiring",
                if en {
                    format!("🌐 {domain}: domain expires in {n} day{}", if n == 1 { "" } else { "s" })
                } else {
                    format!("🌐 {domain}: alan adının süresi {n} gün içinde doluyor")
                },
                format!("{} {date}{registrar}\n{used_by}", pick("Expires on", "Bitiş tarihi:")),
                false,
            )
        }
        Notice::Expired => (
            "domain_expired",
            if en { format!("⛔ {domain}: domain registration has expired") } else { format!("⛔ {domain}: alan adı kaydının süresi doldu") },
            format!("{} {date}{registrar}\n{used_by}", pick("Expired on", "Bitiş tarihi:")),
            false,
        ),
        Notice::Renewed => (
            "domain_renewed",
            if en { format!("✅ {domain}: domain renewed") } else { format!("✅ {domain}: alan adı yenilendi") },
            format!("{} {date}{registrar}\n{used_by}", pick("Valid until", "Geçerlilik sonu:")),
            true,
        ),
    };
    if let Some(first) = monitors.first() {
        crate::activity::record(
            state,
            kind,
            first,
            Some(json!({ "domain": domain, "expires_at": expires, "days_left": (expires - now_ms()).div_euclid(DAY_MS) })),
        )
        .await;
    }
    let ids: Vec<i64> = monitors.iter().map(|m| m.id).collect();
    let alert = Alert { title, body, up, monitor: Some(json!({ "domain": domain })), buttons_for: None };
    notify::deliver_many(state, &ids, &alert).await;
}

// ---------- background task ----------

fn due(entry: Option<&DomainEntry>, now: i64) -> bool {
    match entry {
        None => true,
        Some(e) if e.error.is_some() => now - e.checked_at >= 6 * 3600 * 1000,
        Some(e) => {
            let every = if e.days_left(now).unwrap_or(0) > 90 { 24 } else { 12 };
            now - e.checked_at >= every * 3600 * 1000
        }
    }
}

/// Force a fresh lookup of every domain on the next scan.
pub fn recheck_all(state: &AppState) {
    for e in state.domains.write().unwrap_or_else(|e| e.into_inner()).values_mut() {
        e.checked_at = 0;
    }
}

pub async fn run(state: AppState) {
    tokio::time::sleep(Duration::from_secs(45)).await;
    loop {
        if let Ok(monitors) = state.db.call(|c| models::list_monitors(c)).await {
            let mut by_domain: HashMap<String, Vec<&Monitor>> = HashMap::new();
            for m in monitors.iter().filter(|m| m.active) {
                if let Some(d) = registrable(m) {
                    by_domain.entry(d).or_default().push(m);
                }
            }
            let mut changed = false;
            for (domain, users) in &by_domain {
                let now = now_ms();
                let prev = state.domains.read().unwrap_or_else(|e| e.into_inner()).get(domain).cloned();
                if !due(prev.as_ref(), now) {
                    continue;
                }
                let result = lookup(&state.http, domain).await;
                let mut entry = match (&result, &prev) {
                    (Ok(info), _) => DomainEntry {
                        expires_at: Some(info.expires_at),
                        registrar: info.registrar.clone(),
                        checked_at: now,
                        alerted_level: NO_ALERT,
                        error: None,
                    },
                    // Keep the last known date when a refresh fails.
                    (Err(e), Some(p)) => DomainEntry { checked_at: now, error: Some(format!("{e:#}")), ..p.clone() },
                    (Err(e), None) => DomainEntry { expires_at: None, registrar: None, checked_at: now, alerted_level: NO_ALERT, error: Some(format!("{e:#}")) },
                };
                if let Err(e) = &result {
                    tracing::debug!("domain lookup {domain}: {e:#}");
                }
                let notice = if result.is_ok() { evaluate(prev.as_ref(), &mut entry, now) } else { None };
                let (d2, e2) = (domain.clone(), entry.clone());
                if let Err(e) = state.db.call(move |c| save(c, &d2, &e2)).await {
                    tracing::warn!("saving domain info failed: {e:#}");
                }
                changed |= prev.as_ref().is_none_or(|p| p.expires_at != entry.expires_at || p.error != entry.error);
                state.domains.write().unwrap_or_else(|e| e.into_inner()).insert(domain.clone(), entry.clone());
                if let Some(n) = notice {
                    announce(&state, domain, &entry, users, n).await;
                }
                // Be gentle with registries.
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            let known: HashSet<&String> = by_domain.keys().collect();
            let before = state.domains.read().unwrap_or_else(|e| e.into_inner()).len();
            state.domains.write().unwrap_or_else(|e| e.into_inner()).retain(|d, _| known.contains(d));
            changed |= before != state.domains.read().unwrap_or_else(|e| e.into_inner()).len();
            if changed {
                state.notify_monitors_changed();
            }
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

// ---------- API ----------

pub fn router() -> Router<AppState> {
    Router::new().route("/domains", get(list)).route("/domains/check", post(check))
}

async fn list_json(st: &AppState) -> ApiResult<Json<Value>> {
    let monitors = st.db.call(|c| models::list_monitors(c)).await?;
    let now = now_ms();
    let mut users: HashMap<String, Vec<i64>> = HashMap::new();
    for m in &monitors {
        if let Some(d) = registrable(m) {
            users.entry(d).or_default().push(m.id);
        }
    }
    let domains = st.domains.read().unwrap_or_else(|e| e.into_inner());
    let mut items: Vec<Value> = users
        .iter()
        .map(|(name, ids)| {
            let mut v = domains
                .get(name)
                .map(|e| e.to_json(name, now))
                .unwrap_or_else(|| json!({ "name": name, "expires_at": null, "days_left": null, "status": "unknown", "registrar": null, "checked_at": null, "error": null }));
            v["monitor_ids"] = json!(ids);
            v
        })
        .collect();
    items.sort_by_key(|v| (v["expires_at"].as_i64().is_none(), v["expires_at"].as_i64().unwrap_or(0), v["name"].as_str().unwrap_or("").to_string()));
    Ok(Json(json!({ "items": items })))
}

async fn list(State(st): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let visible = crate::api::visible_for(&st, &user).await?;
    let Json(mut all) = list_json(&st).await?;
    if let Some(v) = visible
        && let Some(items) = all["items"].as_array_mut()
    {
        items.retain_mut(|i| {
            let ids: Vec<i64> = i["monitor_ids"]
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_i64).filter(|id| v.contains(id)).collect())
                .unwrap_or_default();
            i["monitor_ids"] = json!(ids);
            !ids.is_empty()
        });
    }
    Ok(Json(all))
}

async fn check(State(st): State<AppState>, Admin(_): Admin) -> ApiResult<Json<Value>> {
    recheck_all(&st);
    list_json(&st).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ymd(y: i64, m: i64, d: i64) -> i64 {
        crate::cert::unix_ms(y, m, d, 12, 0, 0)
    }

    #[test]
    fn parses_common_date_formats() {
        assert_eq!(parse_date("2027-Jun-11."), Some(ymd(2027, 6, 11)));
        assert_eq!(parse_date("2027-06-11T10:20:30Z"), Some(ymd(2027, 6, 11)));
        assert_eq!(parse_date("2027-06-11 10:20:30"), Some(ymd(2027, 6, 11)));
        assert_eq!(parse_date("11-Jun-2027"), Some(ymd(2027, 6, 11)));
        assert_eq!(parse_date("2027.06.11"), Some(ymd(2027, 6, 11)));
        assert_eq!(parse_date("11/06/2027"), Some(ymd(2027, 6, 11)));
        assert_eq!(parse_date("20270611"), Some(ymd(2027, 6, 11)));
        assert_eq!(parse_date("soon"), None);
    }

    #[test]
    fn parses_a_turkish_whois_reply() {
        let text = "** Domain Name: teraphill15.com.tr\nDomain Status: Active\n\n** Registrar:\nNIC Handle\t\t: ogv40\nOrganization Name\t: ODTÜ GELİŞTİRME VAKFI\n\n** Additional Info:\nCreated on..............: 2024-Jun-12.\nExpires on..............: 2027-Jun-11.\n";
        let info = parse_whois(text).unwrap();
        assert_eq!(info.expires_at, ymd(2027, 6, 11));
        assert_eq!(info.registrar.as_deref(), Some("ODTÜ GELİŞTİRME VAKFI"));
    }

    #[test]
    fn parses_a_generic_whois_reply() {
        let text = "Domain Name: EXAMPLE.COM\nRegistrar: Example Registrar, Inc.\nRegistry Expiry Date: 2028-08-13T04:00:00Z\nRegistrar Abuse Contact Email: abuse@example.com\n";
        let info = parse_whois(text).unwrap();
        assert_eq!(info.expires_at, ymd(2028, 8, 13));
        assert_eq!(info.registrar.as_deref(), Some("Example Registrar, Inc."));
        assert!(parse_whois("No match for domain \"X\"").is_err());
        assert!(parse_whois("Domain Name: x.de\nStatus: connect\n").is_err());
    }

    #[test]
    fn registrable_domains() {
        let mk = |url: &str| Monitor {
            id: 1,
            active: true,
            cfg: serde_json::from_value(json!({ "name": "x", "type": "http", "url": url })).unwrap(),
        };
        assert_eq!(registrable(&mk("https://www.teraphill15.com.tr/path")).as_deref(), Some("teraphill15.com.tr"));
        assert_eq!(registrable(&mk("https://a.b.example.org")).as_deref(), Some("example.org"));
        assert_eq!(registrable(&mk("https://192.168.1.10/")), None);
        assert_eq!(registrable(&mk("http://localhost:3000")), None);
        assert_eq!(registrable(&mk("https://printer.local")), None);
    }

    #[test]
    fn alert_levels_fire_once_per_threshold() {
        let now = ymd(2026, 10, 14);
        let mut e = DomainEntry { expires_at: Some(now + 50 * DAY_MS), registrar: None, checked_at: now, alerted_level: NO_ALERT, error: None };
        assert_eq!(evaluate(None, &mut e, now), Some(Notice::Expiring(50)));
        assert_eq!(e.alerted_level, 60);
        let prev = e.clone();
        let mut e2 = DomainEntry { alerted_level: NO_ALERT, ..prev.clone() };
        assert_eq!(evaluate(Some(&prev), &mut e2, now + DAY_MS), None);
        let mut e3 = DomainEntry { alerted_level: NO_ALERT, ..prev.clone() };
        assert_eq!(evaluate(Some(&prev), &mut e3, now + 25 * DAY_MS), Some(Notice::Expiring(25)));
        let mut healthy = DomainEntry { expires_at: Some(now + 400 * DAY_MS), registrar: None, checked_at: now, alerted_level: NO_ALERT, error: None };
        assert_eq!(evaluate(None, &mut healthy, now), None);
        let mut renewed = DomainEntry { expires_at: Some(now + 400 * DAY_MS), registrar: None, checked_at: now, alerted_level: NO_ALERT, error: None };
        assert_eq!(evaluate(Some(&e3), &mut renewed, now + 26 * DAY_MS), Some(Notice::Renewed));
    }
}
