//! TLS certificate monitoring: reads the leaf certificate of HTTPS monitors,
//! shows its expiry in the UI and sends warnings through the monitor's
//! notification channels before it expires.

use std::collections::HashMap;
use std::time::Duration;

use anyhow::Result;
use rusqlite::Connection;

use crate::check::Clients;
use crate::db::now_ms;
use crate::models::{self, Monitor, MonitorType};
use crate::notify::{self, Alert};
use crate::state::AppState;

const DAY_MS: i64 = 86_400_000;
/// Days before expiry at which a warning is sent (and "expired" at 0).
const WARN_DAYS: [i64; 4] = [14, 7, 3, 1];
const NO_ALERT: i64 = 99;

#[derive(Debug, Clone)]
pub struct CertEntry {
    pub expires_at: i64,
    pub issuer: Option<String>,
    pub checked_at: i64,
    /// Lowest threshold already notified (99 = none, 0 = expired).
    pub alerted_level: i64,
}

pub type Certs = HashMap<i64, CertEntry>;

impl CertEntry {
    pub fn days_left(&self, now: i64) -> i64 {
        (self.expires_at - now).div_euclid(DAY_MS)
    }

    pub fn status(&self, now: i64) -> &'static str {
        if self.expires_at <= now {
            "expired"
        } else if self.days_left(now) <= WARN_DAYS[0] {
            "expiring"
        } else {
            "ok"
        }
    }

    pub fn to_json(&self, now: i64) -> serde_json::Value {
        serde_json::json!({
            "expires_at": self.expires_at,
            "days_left": self.days_left(now),
            "status": self.status(now),
            "issuer": self.issuer,
            "checked_at": self.checked_at,
        })
    }
}

// ---------- DER parsing (just enough of X.509 to read the validity and issuer) ----------

/// Split one TLV: (tag, content, rest).
fn tlv(data: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let tag = *data.first()?;
    let len_byte = *data.get(1)?;
    let (len, header) = if len_byte < 0x80 {
        (len_byte as usize, 2)
    } else {
        let n = (len_byte & 0x7f) as usize;
        if n == 0 || n > 4 {
            return None;
        }
        let mut len = 0usize;
        for b in data.get(2..2 + n)? {
            len = (len << 8) | *b as usize;
        }
        (len, 2 + n)
    };
    let content = data.get(header..header + len)?;
    Some((tag, content, &data[header + len..]))
}

/// Parse an ASN.1 UTCTime / GeneralizedTime into unix milliseconds.
fn parse_time(tag: u8, s: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(s).ok()?.trim_end_matches('Z');
    let num = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    let (year, rest) = match tag {
        0x17 => {
            let yy = num(0, 2)?;
            (if yy >= 50 { 1900 + yy } else { 2000 + yy }, 2)
        }
        0x18 => (num(0, 4)?, 4),
        _ => return None,
    };
    Some(unix_ms(year, num(rest, rest + 2)?, num(rest + 2, rest + 4)?, num(rest + 4, rest + 6)?, num(rest + 6, rest + 8)?, num(rest + 8, rest + 10).unwrap_or(0)))
}

/// Civil date/time (UTC) to unix milliseconds (Howard Hinnant's days_from_civil).
pub fn unix_ms(y: i64, m: i64, d: i64, hh: i64, mm: i64, ss: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    (days * 86_400 + hh * 3600 + mm * 60 + ss) * 1000
}

/// "2026-10-24" for a unix-millisecond timestamp.
pub fn ymd(ms: i64) -> String {
    let days = ms.div_euclid(DAY_MS);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

pub struct ParsedCert {
    pub not_after: i64,
    pub issuer: Option<String>,
}

pub fn parse_cert(der: &[u8]) -> Option<ParsedCert> {
    let (_, cert, _) = tlv(der)?; // Certificate ::= SEQUENCE
    let (_, tbs, _) = tlv(cert)?; // tbsCertificate ::= SEQUENCE
    // [0] EXPLICIT version (optional), then serialNumber
    let (first_tag, _, after_first) = tlv(tbs)?;
    let after_serial = if first_tag == 0xA0 { tlv(after_first)?.2 } else { after_first };
    let (_, _, rest) = tlv(after_serial)?; // signature AlgorithmIdentifier
    let (_, issuer, rest) = tlv(rest)?; // issuer Name
    let (_, validity, _) = tlv(rest)?; // validity SEQUENCE
    let (_, _not_before, after) = tlv(validity)?;
    let (tag, not_after, _) = tlv(after)?;
    Some(ParsedCert { not_after: parse_time(tag, not_after)?, issuer: issuer_name(issuer) })
}

/// Organization (2.5.4.10) or, failing that, common name (2.5.4.3) of the issuer.
fn issuer_name(mut name: &[u8]) -> Option<String> {
    const O: &[u8] = &[0x55, 0x04, 0x0a];
    const CN: &[u8] = &[0x55, 0x04, 0x03];
    let (mut org, mut cn) = (None, None);
    while let Some((_, set, next)) = tlv(name) {
        name = next;
        let mut set = set;
        while let Some((_, atv, next_atv)) = tlv(set) {
            set = next_atv;
            if let Some((_, oid, rest)) = tlv(atv)
                && let Some((_, value, _)) = tlv(rest)
            {
                let text = String::from_utf8_lossy(value).trim().to_string();
                if oid == O {
                    org = Some(text);
                } else if oid == CN {
                    cn = Some(text);
                }
            }
        }
    }
    org.or(cn).filter(|s| !s.is_empty())
}

// ---------- probing ----------

fn is_https(m: &Monitor) -> bool {
    matches!(m.cfg.kind, MonitorType::Http | MonitorType::Keyword)
        && m.cfg.url.as_deref().is_some_and(|u| u.to_ascii_lowercase().starts_with("https://"))
}

/// Read the leaf certificate of the monitor's origin, ignoring validation
/// errors (an expired certificate must still be readable).
pub async fn probe(clients: &Clients, m: &Monitor) -> Option<(i64, Option<String>)> {
    let url = reqwest::Url::parse(m.cfg.url.as_deref()?).ok()?;
    let origin = format!("{}://{}/", url.scheme(), url.host_str()?);
    let origin = match url.port() {
        Some(p) => format!("{}://{}:{}/", url.scheme(), url.host_str()?, p),
        None => origin,
    };
    let client = clients.probe_client().ok()?;
    let resp = client.head(origin).timeout(Duration::from_secs(15)).send().await.ok()?;
    let info = resp.extensions().get::<reqwest::tls::TlsInfo>()?;
    let parsed = parse_cert(info.peer_certificate()?)?;
    Some((parsed.not_after, parsed.issuer))
}

// ---------- persistence ----------

pub fn load(c: &Connection) -> Result<Certs> {
    let mut st = c.prepare("SELECT monitor_id, expires_at, issuer, checked_at, alerted_level FROM certs")?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                CertEntry { expires_at: r.get(1)?, issuer: r.get(2)?, checked_at: r.get(3)?, alerted_level: r.get(4)? },
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn save(c: &Connection, id: i64, e: &CertEntry) -> Result<()> {
    c.execute(
        "INSERT INTO certs (monitor_id, expires_at, issuer, checked_at, alerted_level) VALUES (?,?,?,?,?) \
         ON CONFLICT(monitor_id) DO UPDATE SET expires_at = excluded.expires_at, issuer = excluded.issuer, \
         checked_at = excluded.checked_at, alerted_level = excluded.alerted_level",
        rusqlite::params![id, e.expires_at, e.issuer, e.checked_at, e.alerted_level],
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
    // Smallest threshold that the remaining time falls under.
    WARN_DAYS.iter().rev().find(|d| days <= **d).copied().unwrap_or(NO_ALERT)
}

/// Decide what (if anything) to announce for a freshly probed certificate and
/// update `entry.alerted_level` accordingly.
fn evaluate(prev: Option<&CertEntry>, entry: &mut CertEntry, now: i64) -> Option<Notice> {
    let mut alerted = prev.map(|p| p.alerted_level).unwrap_or(NO_ALERT);
    let mut notice = None;
    if let Some(p) = prev
        && entry.expires_at > p.expires_at + 2 * DAY_MS
    {
        // A newer certificate replaced the old one.
        if alerted < NO_ALERT {
            notice = Some(Notice::Renewed);
        }
        alerted = NO_ALERT;
    }
    let level = level_for(entry.expires_at, now);
    if level < alerted {
        notice = Some(if level == 0 { Notice::Expired } else { Notice::Expiring(entry.days_left(now).max(0)) });
        alerted = level;
    }
    entry.alerted_level = alerted;
    notice
}

async fn announce(state: &AppState, m: &Monitor, entry: &CertEntry, notice: Notice) {
    use crate::i18n::pick;
    let name = &m.cfg.name;
    let date = ymd(entry.expires_at);
    let who = entry.issuer.as_deref().map(|i| format!(" ({i})")).unwrap_or_default();
    let (title, body, up) = match notice {
        Notice::Expiring(days) => {
            let n = days.max(1);
            let title = if pick("en", "tr") == "en" {
                format!("🔐 {name}: SSL certificate expires in {n} day{}", if n == 1 { "" } else { "s" })
            } else {
                format!("🔐 {name}: SSL sertifikasının süresi {n} gün içinde doluyor")
            };
            let body = format!("{}\n{} {date}{who}", m.cfg.url.clone().unwrap_or_default(), pick("Expires on", "Bitiş tarihi:"));
            (title, body, false)
        }
        Notice::Expired => {
            let title = if pick("en", "tr") == "en" {
                format!("⛔ {name}: SSL certificate has expired")
            } else {
                format!("⛔ {name}: SSL sertifikasının süresi doldu")
            };
            let body = format!("{}\n{} {date}{who}", m.cfg.url.clone().unwrap_or_default(), pick("Expired on", "Bitiş tarihi:"));
            (title, body, false)
        }
        Notice::Renewed => {
            let title = if pick("en", "tr") == "en" {
                format!("✅ {name}: SSL certificate renewed")
            } else {
                format!("✅ {name}: SSL sertifikası yenilendi")
            };
            let body = format!("{}\n{} {date}{who}", m.cfg.url.clone().unwrap_or_default(), pick("Valid until", "Geçerlilik sonu:"));
            (title, body, true)
        }
    };
    let kind = match notice {
        Notice::Expiring(_) => "ssl_expiring",
        Notice::Expired => "ssl_expired",
        Notice::Renewed => "ssl_renewed",
    };
    crate::activity::record(
        state,
        kind,
        m,
        Some(serde_json::json!({ "expires_at": entry.expires_at, "days_left": entry.days_left(now_ms()) })),
    )
    .await;
    let alert = Alert {
        title,
        body,
        up,
        monitor: Some(serde_json::json!({ "id": m.id, "name": m.cfg.name, "cert_expires_at": entry.expires_at })),
        buttons_for: None,
    };
    notify::deliver(state, m.id, &alert).await;
}

// ---------- background task ----------

/// How often a certificate is re-read: hourly when it needs attention, else every 6 h.
fn due(entry: Option<&CertEntry>, now: i64) -> bool {
    match entry {
        None => true,
        Some(e) => {
            let every = if e.days_left(now) <= 30 { 3600 * 1000 } else { 6 * 3600 * 1000 };
            now - e.checked_at >= every
        }
    }
}

/// Ask for a fresh probe soon (e.g. after a monitor came back up).
pub fn recheck_soon(state: &AppState, monitor_id: i64) {
    if let Some(e) = state.certs.write().unwrap_or_else(|e| e.into_inner()).get_mut(&monitor_id) {
        e.checked_at = 0;
    }
}

pub async fn run(state: AppState) {
    tokio::time::sleep(Duration::from_secs(20)).await;
    loop {
        let monitors = match state.db.call(|c| models::list_monitors(c)).await {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("cert scan: {e:#}");
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }
        };
        let mut changed = false;
        for m in monitors.iter().filter(|m| m.active && is_https(m)) {
            let now = now_ms();
            let prev = state.certs.read().unwrap_or_else(|e| e.into_inner()).get(&m.id).cloned();
            if !due(prev.as_ref(), now) {
                continue;
            }
            let Some((expires_at, issuer)) = probe(&state.clients, m).await else {
                continue;
            };
            let mut entry = CertEntry { expires_at, issuer, checked_at: now, alerted_level: NO_ALERT };
            let notice = evaluate(prev.as_ref(), &mut entry, now);
            let (id, e2) = (m.id, entry.clone());
            if let Err(e) = state.db.call(move |c| save(c, id, &e2)).await {
                tracing::warn!("saving certificate info failed: {e:#}");
            }
            changed |= prev.as_ref().is_none_or(|p| p.expires_at != entry.expires_at || p.status_changed(&entry, now));
            state.certs.write().unwrap_or_else(|e| e.into_inner()).insert(m.id, entry.clone());
            if let Some(n) = notice {
                announce(&state, m, &entry, n).await;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        // Forget certificates of monitors that no longer exist or are no longer HTTPS.
        let live: std::collections::HashSet<i64> = monitors.iter().filter(|m| is_https(m)).map(|m| m.id).collect();
        let before = state.certs.read().unwrap_or_else(|e| e.into_inner()).len();
        state.certs.write().unwrap_or_else(|e| e.into_inner()).retain(|id, _| live.contains(id));
        changed |= before != state.certs.read().unwrap_or_else(|e| e.into_inner()).len();
        if changed {
            state.notify_monitors_changed();
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

impl CertEntry {
    fn status_changed(&self, other: &CertEntry, now: i64) -> bool {
        self.status(now) != other.status(now) || self.days_left(now) != other.days_left(now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(expires_at: i64, level: i64) -> CertEntry {
        CertEntry { expires_at, issuer: None, checked_at: 0, alerted_level: level }
    }

    #[test]
    fn time_roundtrip() {
        let ms = unix_ms(2026, 9, 24, 23, 59, 59);
        assert_eq!(ymd(ms), "2026-09-24");
        assert_eq!(parse_time(0x17, b"260924235959Z"), Some(ms));
        assert_eq!(parse_time(0x18, b"20260924235959Z"), Some(ms));
        assert_eq!(parse_time(0x17, b"991231235959Z"), Some(unix_ms(1999, 12, 31, 23, 59, 59)));
    }

    #[test]
    fn parses_a_real_certificate_structure() {
        // Minimal hand-built DER: SEQ{ SEQ{ [0]{2}, INT, SEQ{}, issuer, validity } }
        let atv = |oid: &[u8], val: &[u8]| {
            let mut a = vec![0x06, oid.len() as u8];
            a.extend_from_slice(oid);
            a.extend_from_slice(&[0x0c, val.len() as u8]);
            a.extend_from_slice(val);
            let mut seq = vec![0x30, a.len() as u8];
            seq.extend(a);
            let mut set = vec![0x31, seq.len() as u8];
            set.extend(seq);
            set
        };
        let mut issuer_body = atv(&[0x55, 0x04, 0x03], b"Some CA");
        issuer_body.extend(atv(&[0x55, 0x04, 0x0a], b"Example Org"));
        let mut issuer = vec![0x30, issuer_body.len() as u8];
        issuer.extend(issuer_body);
        let validity_body = [&[0x17, 13][..], b"250924000000Z", &[0x17, 13][..], b"260924235959Z"].concat();
        let mut validity = vec![0x30, validity_body.len() as u8];
        validity.extend(validity_body);
        let mut tbs_body = vec![0xA0, 3, 0x02, 1, 2, 0x02, 1, 7, 0x30, 0];
        tbs_body.extend(issuer);
        tbs_body.extend(validity);
        let mut tbs = vec![0x30, tbs_body.len() as u8];
        tbs.extend(tbs_body);
        let mut cert = vec![0x30, tbs.len() as u8];
        cert.extend(tbs);
        let parsed = parse_cert(&cert).expect("parses");
        assert_eq!(parsed.not_after, unix_ms(2026, 9, 24, 23, 59, 59));
        assert_eq!(parsed.issuer.as_deref(), Some("Example Org"));
    }

    #[test]
    fn alert_levels() {
        let now = unix_ms(2026, 10, 14, 12, 0, 0);
        assert_eq!(level_for(now + 40 * DAY_MS, now), NO_ALERT);
        assert_eq!(level_for(now + 14 * DAY_MS - 1, now), 14);
        assert_eq!(level_for(now + 5 * DAY_MS, now), 7);
        assert_eq!(level_for(now + 2 * DAY_MS, now), 3);
        assert_eq!(level_for(now + DAY_MS / 2, now), 1);
        assert_eq!(level_for(now - 1, now), 0);
    }

    #[test]
    fn warns_once_per_threshold_and_announces_renewal() {
        let now = unix_ms(2026, 10, 14, 12, 0, 0);
        // first sight at 10 days left → one warning
        let mut e = entry(now + 10 * DAY_MS, NO_ALERT);
        assert_eq!(evaluate(None, &mut e, now), Some(Notice::Expiring(10)));
        assert_eq!(e.alerted_level, 14);
        // next scan, same threshold → silent
        let prev = e.clone();
        let mut e2 = entry(prev.expires_at, 0);
        assert_eq!(evaluate(Some(&prev), &mut e2, now + DAY_MS), None);
        // crossing 7 days → new warning
        let mut e3 = entry(prev.expires_at, 0);
        assert_eq!(evaluate(Some(&prev), &mut e3, now + 4 * DAY_MS), Some(Notice::Expiring(6)));
        assert_eq!(e3.alerted_level, 7);
        // expired
        let mut e4 = entry(prev.expires_at, 0);
        assert_eq!(evaluate(Some(&e3), &mut e4, prev.expires_at + 1), Some(Notice::Expired));
        // renewed
        let mut e5 = entry(prev.expires_at + 90 * DAY_MS, 0);
        assert_eq!(evaluate(Some(&e4), &mut e5, prev.expires_at + 2), Some(Notice::Renewed));
        assert_eq!(e5.alerted_level, NO_ALERT);
        // a healthy certificate seen for the first time is silent
        let mut e6 = entry(now + 80 * DAY_MS, 0);
        assert_eq!(evaluate(None, &mut e6, now), None);
    }
}
