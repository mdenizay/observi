use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use reqwest::Method;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

use crate::models::{Monitor, MonitorType, parse_status_ranges};

pub struct CheckResult {
    pub ok: bool,
    pub latency_ms: Option<u32>,
    pub message: String,
}

const MAX_BODY: usize = 2 * 1024 * 1024;
const USER_AGENT: &str = concat!("Observi/", env!("CARGO_PKG_VERSION"), " (+uptime monitor)");

/// HTTP clients keyed by (ignore_tls, max_redirects). Connection pooling is
/// disabled so every check measures a fresh DNS + TCP + TLS round trip,
/// which is what an uptime monitor should report.
#[derive(Default)]
pub struct Clients {
    clients: Mutex<HashMap<(bool, u32), reqwest::Client>>,
    probe: OnceLock<reqwest::Client>,
}

impl Clients {
    /// Client for reading certificates: accepts any certificate (so an expired
    /// one can still be inspected) and exposes the peer certificate.
    pub fn probe_client(&self) -> reqwest::Result<reqwest::Client> {
        if let Some(c) = self.probe.get() {
            return Ok(c.clone());
        }
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .redirect(reqwest::redirect::Policy::none())
            .pool_max_idle_per_host(0)
            .tls_danger_accept_invalid_certs(true)
            .tls_info(true)
            .connect_timeout(Duration::from_secs(15))
            .build()?;
        Ok(self.probe.get_or_init(|| client).clone())
    }

    fn get(&self, ignore_tls: bool, max_redirects: u32) -> reqwest::Result<reqwest::Client> {
        let mut map = self.clients.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = map.get(&(ignore_tls, max_redirects)) {
            return Ok(c.clone());
        }
        let policy = if max_redirects == 0 {
            reqwest::redirect::Policy::none()
        } else {
            reqwest::redirect::Policy::limited(max_redirects as usize)
        };
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .redirect(policy)
            .pool_max_idle_per_host(0)
            .tls_danger_accept_invalid_certs(ignore_tls)
            .connect_timeout(Duration::from_secs(15))
            .build()?;
        map.insert((ignore_tls, max_redirects), client.clone());
        Ok(client)
    }
}

pub async fn run(clients: &Clients, m: &Monitor) -> CheckResult {
    let mut res = match m.cfg.kind {
        MonitorType::Http | MonitorType::Keyword => http(clients, m).await,
        MonitorType::Tcp => tcp(m).await,
    };
    if m.cfg.upside_down {
        res.ok = !res.ok;
        if res.ok {
            res.message = format!("Upside-down mode: {}", res.message);
        }
    }
    res
}

fn fail(latency: Option<u32>, message: impl Into<String>) -> CheckResult {
    CheckResult { ok: false, latency_ms: latency, message: message.into() }
}

fn elapsed_ms(start: Instant) -> u32 {
    start.elapsed().as_millis().min(u32::MAX as u128) as u32
}

/// Root cause of a reqwest error, which is far more useful than the wrapper text.
fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "Timeout".into();
    }
    let mut src: &dyn std::error::Error = e;
    while let Some(next) = src.source() {
        src = next;
    }
    let root = src.to_string();
    if e.is_redirect() {
        format!("Too many redirects: {root}")
    } else if e.is_connect() {
        format!("Connection error: {root}")
    } else {
        root
    }
}

async fn http(clients: &Clients, m: &Monitor) -> CheckResult {
    let cfg = &m.cfg;
    let url = cfg.url.as_deref().unwrap_or_default();
    let client = match clients.get(cfg.ignore_tls, cfg.max_redirects) {
        Ok(c) => c,
        Err(e) => return fail(None, format!("Client error: {e}")),
    };
    let method = Method::from_bytes(cfg.method.as_bytes()).unwrap_or(Method::GET);
    let mut req = client.request(method, url).timeout(Duration::from_secs(cfg.timeout as u64));
    if let Some(h) = &cfg.headers
        && let Ok(serde_json::Value::Object(obj)) = serde_json::from_str::<serde_json::Value>(h) {
            let mut map = HeaderMap::new();
            for (k, v) in obj {
                let v = match v {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                if let (Ok(k), Ok(v)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(&v)) {
                    map.insert(k, v);
                }
            }
            req = req.headers(map);
        }
    if let Some(b) = &cfg.body {
        req = req.body(b.clone());
    }

    let start = Instant::now();
    let mut resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return fail(Some(elapsed_ms(start)), describe(&e)),
    };
    // cPanel serves a 200 "account suspended" page after a redirect; that's an outage.
    if resp.url().path().contains("/cgi-sys/suspendedpage.cgi") {
        return fail(Some(elapsed_ms(start)), "Hosting account suspended");
    }
    let code = resp.status().as_u16();
    let accepted = parse_status_ranges(&cfg.accepted_status)
        .iter()
        .any(|(a, b)| (*a..=*b).contains(&code));
    let reason = resp.status().canonical_reason().unwrap_or("");

    if cfg.kind != MonitorType::Keyword {
        let latency = elapsed_ms(start);
        return if accepted {
            CheckResult { ok: true, latency_ms: Some(latency), message: format!("{code} {reason}").trim().into() }
        } else {
            fail(Some(latency), format!("HTTP {code} {reason}").trim().to_string())
        };
    }

    if !accepted {
        return fail(Some(elapsed_ms(start)), format!("HTTP {code} {reason}").trim().to_string());
    }
    // Read the body (bounded) and search for the keyword.
    let mut body = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                body.extend_from_slice(&chunk);
                if body.len() >= MAX_BODY {
                    break;
                }
            }
            Ok(None) => break,
            Err(e) => return fail(Some(elapsed_ms(start)), describe(&e)),
        }
    }
    let latency = elapsed_ms(start);
    let text = String::from_utf8_lossy(&body);
    let keyword = cfg.keyword.as_deref().unwrap_or_default();
    let found = text.contains(keyword);
    if found != cfg.invert_keyword {
        CheckResult {
            ok: true,
            latency_ms: Some(latency),
            message: if cfg.invert_keyword {
                format!("{code}, keyword \"{keyword}\" absent")
            } else {
                format!("{code}, keyword \"{keyword}\" found")
            },
        }
    } else if cfg.invert_keyword {
        fail(Some(latency), format!("Keyword \"{keyword}\" found on page"))
    } else {
        fail(Some(latency), format!("Keyword \"{keyword}\" not found on page"))
    }
}

async fn tcp(m: &Monitor) -> CheckResult {
    let host = m.cfg.hostname.as_deref().unwrap_or_default();
    let port = m.cfg.port.unwrap_or(0);
    let start = Instant::now();
    let fut = tokio::net::TcpStream::connect((host, port));
    match tokio::time::timeout(Duration::from_secs(m.cfg.timeout as u64), fut).await {
        Ok(Ok(_)) => CheckResult { ok: true, latency_ms: Some(elapsed_ms(start)), message: "Port open".into() },
        Ok(Err(e)) => fail(Some(elapsed_ms(start)), format!("Connection error: {e}")),
        Err(_) => fail(None, "Timeout"),
    }
}
