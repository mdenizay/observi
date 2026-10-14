use std::time::Duration;

use anyhow::{Context, Result, bail};
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::i18n::{Lang, lang};
use crate::models::{Monitor, MonitorType};
use crate::state::{AppState, UP};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "config", rename_all = "lowercase")]
pub enum Channel {
    Telegram(TelegramCfg),
    Smtp(SmtpCfg),
    Webhook(WebhookCfg),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramCfg {
    pub bot_token: String,
    pub chat_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpCfg {
    pub host: String,
    pub port: u16,
    #[serde(default = "default_security")]
    pub security: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    pub from: String,
    pub to: String,
}

fn default_security() -> String {
    "starttls".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookCfg {
    pub url: String,
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_format() -> String {
    "json".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationInput {
    pub name: String,
    #[serde(flatten)]
    pub channel: Channel,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub apply_existing: bool,
    /// Include this channel in the scheduled uptime reports.
    #[serde(default = "yes")]
    pub digest: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub id: i64,
    pub name: String,
    #[serde(flatten)]
    pub channel: Channel,
    pub is_default: bool,
    pub digest: bool,
}

impl Channel {
    fn kind(&self) -> &'static str {
        match self {
            Channel::Telegram(_) => "telegram",
            Channel::Smtp(_) => "smtp",
            Channel::Webhook(_) => "webhook",
        }
    }

    fn config_json(&self) -> String {
        match self {
            Channel::Telegram(c) => serde_json::to_string(c),
            Channel::Smtp(c) => serde_json::to_string(c),
            Channel::Webhook(c) => serde_json::to_string(c),
        }
        .unwrap_or_default()
    }

    fn from_row(kind: &str, config: &str) -> Option<Channel> {
        serde_json::from_value(json!({ "kind": kind, "config": serde_json::from_str::<serde_json::Value>(config).ok()? }))
            .ok()
    }
}

pub fn list(c: &Connection) -> Result<Vec<Notification>> {
    let mut st = c.prepare_cached("SELECT id, name, kind, config, is_default, digest FROM notifications ORDER BY name")?;
    let rows = st
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get(4)?, r.get(5)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, name, kind, config, is_default, digest)| {
            Some(Notification { id, name, channel: Channel::from_row(&kind, &config)?, is_default, digest })
        })
        .collect())
}

pub fn save(c: &Connection, id: Option<i64>, n: &NotificationInput) -> Result<i64> {
    let id = match id {
        Some(id) => {
            let changed = c.execute(
                "UPDATE notifications SET name=?, kind=?, config=?, is_default=?, digest=? WHERE id=?",
                rusqlite::params![n.name, n.channel.kind(), n.channel.config_json(), n.is_default, n.digest, id],
            )?;
            if changed == 0 {
                bail!("Notification not found");
            }
            id
        }
        None => {
            c.execute(
                "INSERT INTO notifications (name, kind, config, is_default, digest) VALUES (?,?,?,?,?)",
                rusqlite::params![n.name, n.channel.kind(), n.channel.config_json(), n.is_default, n.digest],
            )?;
            c.last_insert_rowid()
        }
    };
    if n.apply_existing {
        c.execute(
            "INSERT OR IGNORE INTO monitor_notifications (monitor_id, notification_id) SELECT id, ? FROM monitors",
            [id],
        )?;
    }
    Ok(id)
}

pub fn default_ids(c: &Connection) -> Result<Vec<i64>> {
    let mut st = c.prepare_cached("SELECT id FROM notifications WHERE is_default = 1")?;
    let ids = st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

fn for_monitor(c: &Connection, monitor_id: i64) -> Result<Vec<Channel>> {
    let mut st = c.prepare_cached(
        "SELECT n.kind, n.config FROM notifications n \
         JOIN monitor_notifications mn ON mn.notification_id = n.id WHERE mn.monitor_id = ?",
    )?;
    let rows = st
        .query_map([monitor_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows.into_iter().filter_map(|(k, cfg)| Channel::from_row(&k, &cfg)).collect())
}

pub struct Alert {
    pub title: String,
    pub body: String,
    pub up: bool,
    pub monitor: Option<serde_json::Value>,
    /// Offer "mute" / "maintenance" buttons for this monitor (Telegram only).
    pub buttons_for: Option<i64>,
}

fn human_duration(ms: i64) -> String {
    let s = ms / 1000;
    let (d, h, m) = (s / 86400, (s % 86400) / 3600, (s % 3600) / 60);
    // (second, minute, hour, day) unit labels
    let (us, um, uh, ud) = match lang() {
        Lang::En => ("s", "min", "h", "d"),
        Lang::Tr => ("sn", "dk", "sa", "gün"),
    };
    match (d, h, m) {
        (0, 0, 0) => format!("{s} {us}"),
        (0, 0, m) => format!("{m} {um}"),
        (0, h, m) => format!("{h} {uh} {m} {um}"),
        (d, h, _) => format!("{d} {ud} {h} {uh}"),
    }
}

/// Called by the scheduler on an UP<->DOWN transition.
pub async fn monitor_changed(state: &AppState, m: &Monitor, status: u8, message: &str, down_for: Option<i64>) {
    // Muted or under maintenance: the change is still recorded, just not announced.
    if state.is_muted(m.id) {
        return;
    }
    let up = status == UP;
    let target = match m.cfg.kind {
        MonitorType::Tcp => format!(
            "{}:{}",
            m.cfg.hostname.as_deref().unwrap_or_default(),
            m.cfg.port.unwrap_or(0)
        ),
        _ => m.cfg.url.clone().unwrap_or_default(),
    };
    let name = &m.cfg.name;
    let title = match (up, lang()) {
        (true, Lang::En) => format!("✅ {name} is back up"),
        (false, Lang::En) => format!("🔴 {name} is down"),
        (true, Lang::Tr) => format!("✅ {name} tekrar çalışıyor"),
        (false, Lang::Tr) => format!("🔴 {name} çöktü"),
    };
    let mut body = format!("{target}\n{message}");
    if let Some(ms) = down_for {
        body.push_str(&format!("\n{}: {}", crate::i18n::pick("Downtime", "Kesinti süresi"), human_duration(ms)));
    }
    let alert = Alert {
        title,
        body,
        up,
        monitor: Some(json!({ "id": m.id, "name": m.cfg.name, "target": target })),
        buttons_for: (!up).then_some(m.id),
    };
    deliver(state, m.id, &alert).await;
}

/// Send an alert through the channels of several monitors, once per channel.
pub async fn deliver_many(state: &AppState, monitor_ids: &[i64], alert: &Alert) {
    let ids = monitor_ids.to_vec();
    let channels = state
        .db
        .call(move |c| {
            let mut wanted = std::collections::HashSet::new();
            let mut st = c.prepare("SELECT notification_id FROM monitor_notifications WHERE monitor_id = ?")?;
            for id in ids {
                for r in st.query_map([id], |r| r.get::<_, i64>(0))? {
                    wanted.insert(r?);
                }
            }
            Ok(list(c)?.into_iter().filter(|n| wanted.contains(&n.id)).collect::<Vec<_>>())
        })
        .await
        .unwrap_or_default();
    for n in channels {
        if let Err(e) = send(state, &n.channel, alert).await {
            tracing::warn!("notification failed ({}): {e:#}", n.channel.kind());
        }
    }
}

/// Send an alert through every notification channel attached to a monitor.
pub async fn deliver(state: &AppState, monitor_id: i64, alert: &Alert) {
    let channels = match state.db.call(move |c| for_monitor(c, monitor_id)).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("load notifications: {e:#}");
            return;
        }
    };
    for ch in channels {
        if let Err(e) = send(state, &ch, alert).await {
            tracing::warn!("notification failed ({}): {e:#}", ch.kind());
        }
    }
}

pub async fn send(state: &AppState, ch: &Channel, alert: &Alert) -> Result<()> {
    let timeout = Duration::from_secs(20);
    match ch {
        Channel::Telegram(cfg) => {
            let url = format!("https://api.telegram.org/bot{}/sendMessage", cfg.bot_token.trim());
            let resp = state
                .http
                .post(url)
                .timeout(timeout)
                .json(&{
                    let mut body = json!({
                        "chat_id": cfg.chat_id.trim(),
                        "text": format!("{}\n{}", alert.title, alert.body),
                        "disable_web_page_preview": true,
                    });
                    if let Some(id) = alert.buttons_for {
                        body["reply_markup"] = crate::telegram::alert_buttons(id);
                    }
                    body
                })
                .send()
                .await
                .context("Could not reach Telegram")?;
            if !resp.status().is_success() {
                let text = resp.text().await.unwrap_or_default();
                bail!("Telegram error: {text}");
            }
        }
        Channel::Webhook(cfg) => {
            let text = format!("{}\n{}", alert.title, alert.body);
            let payload = match cfg.format.as_str() {
                "discord" => json!({ "content": text }),
                "slack" => json!({ "text": text }),
                _ => json!({
                    "status": if alert.up { "up" } else { "down" },
                    "title": alert.title,
                    "message": alert.body,
                    "monitor": alert.monitor,
                    "time": crate::db::now_ms(),
                }),
            };
            let resp = state
                .http
                .post(cfg.url.trim())
                .timeout(timeout)
                .json(&payload)
                .send()
                .await
                .context("Could not reach the webhook URL")?;
            if !resp.status().is_success() {
                bail!("Webhook HTTP {}", resp.status());
            }
        }
        Channel::Smtp(cfg) => send_mail(cfg, &cfg.to, &alert.title, &alert.body).await?,
    }
    Ok(())
}

/// Send one plain-text e-mail through an SMTP channel's server.
pub async fn send_mail(cfg: &SmtpCfg, to: &str, subject: &str, body: &str) -> Result<()> {
    let timeout = Duration::from_secs(20);
    let mut builder = Message::builder().from(cfg.from.parse::<Mailbox>().context("Invalid sender address")?).subject(subject);
    for to in to.split([',', ';']).map(str::trim).filter(|s| !s.is_empty()) {
        builder = builder.to(to.parse::<Mailbox>().with_context(|| format!("Invalid recipient address: {to}"))?);
    }
    let email = builder.body(body.to_string())?;
    let mut transport = match cfg.security.as_str() {
        "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&cfg.host)?,
        "none" => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&cfg.host),
        _ => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.host)?,
    }
    .port(cfg.port)
    .timeout(Some(timeout));
    if let (Some(u), Some(p)) = (&cfg.username, &cfg.password)
        && !u.is_empty()
    {
        transport = transport.credentials(Credentials::new(u.clone(), p.clone()));
    }
    transport.build().send(email).await.context("Could not send the e-mail")?;
    Ok(())
}

/// The SMTP server used for system mail: the default channel if it is SMTP, else the first SMTP channel.
pub fn smtp_for_system_mail(c: &Connection) -> Result<Option<SmtpCfg>> {
    let mut found: Option<(bool, SmtpCfg)> = None;
    for n in list(c)? {
        if let Channel::Smtp(cfg) = n.channel
            && found.as_ref().is_none_or(|(d, _)| !d && n.is_default)
        {
            found = Some((n.is_default, cfg));
        }
    }
    Ok(found.map(|(_, c)| c))
}

pub fn test_alert(app: &str) -> Alert {
    Alert {
        title: format!("🔔 {app} {}", crate::i18n::pick("test notification", "test bildirimi")),
        body: crate::i18n::pick("This channel is configured correctly.", "Bu kanal doğru yapılandırıldı.").into(),
        up: true,
        monitor: None,
            buttons_for: None,
}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations() {
        assert_eq!(human_duration(45_000), "45 s");
        assert_eq!(human_duration(5 * 60_000), "5 min");
        assert_eq!(human_duration((2 * 3600 + 5 * 60) * 1000), "2 h 5 min");
        assert_eq!(human_duration((3 * 86400 + 4 * 3600) * 1000), "3 d 4 h");
    }
}
