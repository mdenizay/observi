mod api;
mod auth;
mod brand;
mod check;
mod db;
mod i18n;
mod models;
mod notify;
mod scheduler;
mod state;
mod web;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use axum::Router;
use axum::http::{HeaderValue, header};
use tokio::sync::{broadcast, mpsc, watch};

use crate::db::Db;
use crate::models::{MonitorConfig, MonitorType, Role};
use crate::state::AppState;

const USAGE: &str = "observi — lightweight uptime monitor

Usage:
  observi [serve]                         Start the server
  observi user-add <username> <name> [superadmin|user]
                                          Create a user (password from OBSERVI_PASSWORD
                                          or generated and printed)
  observi passwd <username>               Reset a password (same password rules)
  observi import-kuma <kuma.db>           Import HTTP/keyword/port monitors from Uptime Kuma
  observi health                          Exit 0 if the local server responds (for health checks)
  observi --version

Environment:
  OBSERVI_DB         database path (default ./observi.db)
  OBSERVI_LISTEN     listen address (default 127.0.0.1:3001)
  OBSERVI_RETENTION  heartbeat retention in days (default 90)
  OBSERVI_LANG       language of notifications: en (default) or tr
  OBSERVI_ADMIN_USER / OBSERVI_ADMIN_PASSWORD
                     first superadmin created on an empty database (password
                     generated and logged once if unset)
  RUST_LOG           log filter (default info)";

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,rustls_platform_verifier=off".into()),
        )
        .init();

    i18n::init(&env("OBSERVI_LANG", "en"));
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("health") {
        return health();
    }
    if matches!(args.first().map(String::as_str), Some("--version" | "-V" | "version")) {
        println!("observi {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let db = Db::open(&env("OBSERVI_DB", "observi.db")).context("open database")?;

    match args.first().map(String::as_str) {
        None | Some("serve") => serve(db),
        Some("user-add") => {
            let (Some(username), Some(name)) = (args.get(1), args.get(2)) else { bail!("{USAGE}") };
            let role = Role::parse(args.get(3).map(String::as_str).unwrap_or("user"));
            let (password, generated) = password_from_env();
            let username = username.to_lowercase();
            db.blocking(|c| auth::create_user(c, &username, name, &password, role))?;
            println!("Created {} '{username}'.", role.as_str());
            if generated {
                println!("Password: {password}");
            }
            Ok(())
        }
        Some("passwd") => {
            let Some(username) = args.get(1) else { bail!("{USAGE}") };
            let (password, generated) = password_from_env();
            let n = db.blocking(|c| {
                let n = c.execute(
                    "UPDATE users SET password_hash = ? WHERE username = ?",
                    rusqlite::params![auth::hash_password(&password)?, username.to_lowercase()],
                )?;
                c.execute(
                    "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)",
                    [username.to_lowercase()],
                )?;
                Ok(n)
            })?;
            if n == 0 {
                bail!("no such user");
            }
            println!("Password updated.");
            if generated {
                println!("Password: {password}");
            }
            Ok(())
        }
        Some("import-kuma") => {
            let Some(path) = args.get(1) else { bail!("{USAGE}") };
            import_kuma(&db, path)
        }
        _ => {
            println!("{USAGE}");
            Ok(())
        }
    }
}

fn password_from_env() -> (String, bool) {
    match std::env::var("OBSERVI_PASSWORD") {
        Ok(p) if p.len() >= 8 => (p, false),
        _ => (auth::random_hex(9), true),
    }
}

/// Exit 0 if the local server answers HTTP; used by container health checks.
/// Plain std networking so it works in a minimal image without curl.
fn health() -> Result<()> {
    use std::io::{Read, Write};
    let listen = env("OBSERVI_LISTEN", "127.0.0.1:3001");
    let port = listen.rsplit(':').next().unwrap_or("3001");
    let addr = format!("127.0.0.1:{port}");
    let mut stream = std::net::TcpStream::connect_timeout(&addr.parse()?, Duration::from_secs(3))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.write_all(b"GET /api/branding HTTP/1.0\r\nHost: localhost\r\n\r\n")?;
    let mut buf = [0u8; 16];
    let n = stream.read(&mut buf)?;
    if buf[..n].starts_with(b"HTTP/1.1 200") || buf[..n].starts_with(b"HTTP/1.0 200") {
        Ok(())
    } else {
        bail!("unhealthy")
    }
}

/// On an empty database, create the first superadmin from OBSERVI_ADMIN_USER /
/// OBSERVI_ADMIN_PASSWORD (generated and logged once when unset). Handy for containers.
fn bootstrap_admin(db: &Db) -> Result<()> {
    db.blocking(|c| {
        let users: i64 = c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
        if users > 0 {
            return Ok(());
        }
        let username = env("OBSERVI_ADMIN_USER", "admin").trim().to_lowercase();
        let (password, generated) = match std::env::var("OBSERVI_ADMIN_PASSWORD") {
            Ok(p) if p.chars().count() >= 8 => (p, false),
            Ok(_) => bail!("OBSERVI_ADMIN_PASSWORD must be at least 8 characters"),
            Err(_) => (auth::random_hex(9), true),
        };
        auth::create_user(c, &username, "Administrator", &password, Role::Superadmin)?;
        if generated {
            tracing::warn!(
                "created superadmin '{username}' with password: {password} (shown once; change it under Settings)"
            );
        } else {
            tracing::info!("created superadmin '{username}' from OBSERVI_ADMIN_PASSWORD");
        }
        Ok(())
    })
}

fn serve(db: Db) -> Result<()> {
    bootstrap_admin(&db)?;
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(8)
        .enable_all()
        .build()?;
    rt.block_on(async move {
        let live = db.call(|c| scheduler::load_live(c)).await?;
        let (events, _) = broadcast::channel(1024);
        let (writer_tx, writer_rx) = mpsc::channel(4096);
        let state = AppState {
            db,
            live: Arc::new(RwLock::new(live)),
            uptime24: Arc::new(RwLock::new(HashMap::new())),
            events,
            writer: writer_tx,
            scheduler: Arc::default(),
            throttle: Arc::default(),
            http: reqwest::Client::builder()
                .user_agent(concat!("Observi/", env!("CARGO_PKG_VERSION")))
                .build()?,
            clients: Arc::default(),
            shutdown: Arc::new(watch::channel(false).0),
        };

        let retention: i64 = env("OBSERVI_RETENTION", "90").parse().unwrap_or(90).max(31);
        let writer = tokio::spawn(scheduler::writer(state.clone(), writer_rx, state.shutdown.subscribe()));
        tokio::spawn(scheduler::maintenance(state.clone(), retention));
        scheduler::start_all(&state).await?;

        let app = Router::new()
            .nest("/api", api::router())
            .fallback(web::static_handler)
            .layer(axum::middleware::map_response(security_headers))
            .with_state(state.clone());

        let addr = env("OBSERVI_LISTEN", "127.0.0.1:3001");
        let listener = tokio::net::TcpListener::bind(&addr).await.with_context(|| format!("bind {addr}"))?;
        tracing::info!("Observi listening on http://{addr}");
        let sd = state.shutdown.clone();
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                shutdown().await;
                let _ = sd.send(true);
            })
            .await?;

        // Flush pending heartbeats before exit.
        drop(state);
        let _ = tokio::time::timeout(Duration::from_secs(5), writer).await;
        Ok(())
    })
}

async fn security_headers(mut res: axum::response::Response) -> axum::response::Response {
    let h = res.headers_mut();
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("strict-origin-when-cross-origin"));
    res
}

async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("shutting down");
}

/// Import monitors from an Uptime Kuma SQLite database (read-only).
fn import_kuma(db: &Db, path: &str) -> Result<()> {
    let kuma = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut st = kuma.prepare(
        "SELECT name, type, url, method, keyword, invert_keyword, hostname, port, interval, retry_interval, \
         maxretries, timeout, accepted_statuscodes_json, ignore_tls, upside_down, maxredirects, headers, body, \
         description, active FROM monitor ORDER BY id",
    )?;
    let rows = st
        .query_map([], |r| {
            let kind: String = r.get(1)?;
            let statuses: Option<String> = r.get(12)?;
            let accepted = statuses
                .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
                .map(|v| v.join(","))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "200-299".into());
            let timeout: Option<f64> = r.get(11)?;
            Ok((
                kind,
                MonitorConfig {
                    name: r.get(0)?,
                    kind: MonitorType::Http,
                    url: r.get(2)?,
                    method: r.get::<_, Option<String>>(3)?.unwrap_or_else(|| "GET".into()),
                    keyword: r.get(4)?,
                    invert_keyword: r.get::<_, Option<bool>>(5)?.unwrap_or(false),
                    hostname: r.get(6)?,
                    port: r.get(7)?,
                    interval: r.get(8)?,
                    retry_interval: r.get(9)?,
                    max_retries: r.get(10)?,
                    timeout: timeout.map(|t| t.ceil() as u32).filter(|t| *t > 0).unwrap_or(30),
                    accepted_status: accepted,
                    ignore_tls: r.get(13)?,
                    upside_down: r.get(14)?,
                    max_redirects: r.get(15)?,
                    headers: r.get(16)?,
                    body: r.get(17)?,
                    description: r.get(18)?,
                    group_id: None,
                },
                r.get::<_, bool>(19)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut imported = 0;
    db.blocking(|c| {
        let tx = c.transaction()?;
        for (kind, mut cfg, active) in rows {
            cfg.kind = match kind.as_str() {
                "http" => MonitorType::Http,
                "keyword" => MonitorType::Keyword,
                "port" => MonitorType::Tcp,
                other => {
                    println!("skip '{}' (unsupported type {other})", cfg.name);
                    continue;
                }
            };
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM monitors WHERE name = ?)",
                [&cfg.name],
                |r| r.get(0),
            )?;
            if exists {
                println!("skip '{}' (already exists)", cfg.name);
                continue;
            }
            let name = cfg.name.clone();
            match cfg.validate() {
                Ok(cfg) => {
                    let id = models::insert_monitor(&tx, &cfg, active)?;
                    let defaults = notify::default_ids(&tx)?;
                    models::set_monitor_notifications(&tx, id, &defaults)?;
                    imported += 1;
                }
                Err(e) => println!("skip '{name}': {e}"),
            }
        }
        tx.commit()?;
        Ok(())
    })?;
    println!("Imported {imported} monitors.");
    Ok(())
}
