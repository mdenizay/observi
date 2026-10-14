//! Telegram interaction: inline buttons on alerts (mute / maintenance) and the
//! `/status`, `/down`, `/ssl` commands.
//!
//! Observi long-polls the Bot API (`getUpdates`), so nothing has to be exposed
//! to the internet. Only chats that are configured as notification channels are
//! served; their monitors are the ones attached to those channels.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tokio::task::AbortHandle;

use crate::audit::{self, Entry};
use crate::db::now_ms;
use crate::i18n::pick;
use crate::maintenance::{self, Kind};
use crate::models;
use crate::notify::{Channel, TelegramCfg};
use crate::state::{AppState, status_str};

#[derive(Debug, Clone)]
struct Chat {
    notification_id: i64,
    token: String,
    chat_id: String,
}

fn load_chats(c: &rusqlite::Connection) -> Result<Vec<Chat>> {
    Ok(crate::notify::list(c)?
        .into_iter()
        .filter_map(|n| match n.channel {
            Channel::Telegram(TelegramCfg { bot_token, chat_id }) => {
                Some(Chat { notification_id: n.id, token: bot_token.trim().to_string(), chat_id: chat_id.trim().to_string() })
            }
            _ => None,
        })
        .collect())
}

async fn call(state: &AppState, token: &str, method: &str, body: Value, timeout: u64) -> Result<Value> {
    let resp = state
        .http
        .post(format!("https://api.telegram.org/bot{token}/{method}"))
        .timeout(Duration::from_secs(timeout))
        .json(&body)
        .send()
        .await
        .context("could not reach Telegram")?;
    let status = resp.status();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        bail!("Telegram {method}: HTTP {} {}", status.as_u16(), v["description"].as_str().unwrap_or(""));
    }
    Ok(v)
}

/// Keep one poller per distinct bot token, following channel changes.
pub async fn run(state: AppState) {
    let mut pollers: HashMap<String, AbortHandle> = HashMap::new();
    loop {
        let tokens: HashSet<String> = match state.db.call(|c| load_chats(c)).await {
            Ok(chats) => chats.into_iter().map(|c| c.token).filter(|t| !t.is_empty()).collect(),
            Err(e) => {
                tracing::warn!("telegram: could not load channels: {e:#}");
                HashSet::new()
            }
        };
        pollers.retain(|t, h| {
            let keep = tokens.contains(t) && !h.is_finished();
            if !keep {
                h.abort();
            }
            keep
        });
        for t in tokens {
            pollers.entry(t.clone()).or_insert_with(|| {
                let st = state.clone();
                tokio::spawn(async move { poll(st, t).await }).abort_handle()
            });
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

async fn poll(state: AppState, token: String) {
    // Skip whatever piled up while Observi was not running.
    let mut offset: i64 = 0;
    if let Ok(v) = call(&state, &token, "getUpdates", json!({ "offset": -1, "timeout": 0 }), 15).await
        && let Some(last) = v["result"].as_array().and_then(|a| a.last()).and_then(|u| u["update_id"].as_i64())
    {
        offset = last + 1;
    }
    loop {
        let body = json!({ "offset": offset, "timeout": 25, "allowed_updates": ["message", "callback_query"] });
        match call(&state, &token, "getUpdates", body, 40).await {
            Ok(v) => {
                for u in v["result"].as_array().cloned().unwrap_or_default() {
                    if let Some(id) = u["update_id"].as_i64() {
                        offset = offset.max(id + 1);
                    }
                    if let Err(e) = handle(&state, &token, &u).await {
                        tracing::warn!("telegram update failed: {e:#}");
                    }
                }
            }
            Err(e) => {
                // 409 = another consumer/webhook; anything else: transient.
                let wait = if format!("{e:#}").contains("409") { 60 } else { 10 };
                tracing::warn!("telegram polling: {e:#}");
                tokio::time::sleep(Duration::from_secs(wait)).await;
            }
        }
    }
}

fn person(u: &Value) -> String {
    let from = &u["from"];
    match from["username"].as_str() {
        Some(n) => format!("@{n}"),
        None => from["first_name"].as_str().unwrap_or("someone").to_string(),
    }
}

async fn handle(state: &AppState, token: &str, update: &Value) -> Result<()> {
    if let Some(cb) = update.get("callback_query") {
        return handle_callback(state, token, cb).await;
    }
    let Some(msg) = update.get("message") else { return Ok(()) };
    let text = msg["text"].as_str().unwrap_or("");
    if !text.starts_with('/') {
        return Ok(());
    }
    let chat_id = msg["chat"]["id"].as_i64().unwrap_or_default().to_string();
    if msg["chat"]["type"].as_str() == Some("private")
        && let Some(code) = link_code(text)
    {
        let reply = match link_chat(state, &code, &chat_id).await? {
            Some(name) => format!("{} {name}", pick("Linked to the account of", "Hesap bağlandı:")),
            None => pick("This link code is not valid or has expired.", "Bu bağlantı kodu geçersiz veya süresi dolmuş.").to_string(),
        };
        call(state, token, "sendMessage", json!({ "chat_id": chat_id, "text": reply }), 20).await?;
        return Ok(());
    }
    let cmd = text.split_whitespace().next().unwrap_or("").trim_start_matches('/');
    let cmd = cmd.split('@').next().unwrap_or("").to_lowercase();

    let (tok, cid) = (token.to_string(), chat_id.clone());
    let chats = state.db.call(|c| load_chats(c)).await?;
    let mine: Vec<&Chat> = chats.iter().filter(|c| c.token == tok && c.chat_id == cid).collect();
    if mine.is_empty() {
        return Ok(()); // not one of our channels
    }
    let monitor_ids = chat_monitors(state, &mine.iter().map(|c| c.notification_id).collect::<Vec<_>>()).await?;
    let reply = match cmd.as_str() {
        "status" | "durum" => status_text(state, &monitor_ids, false).await?,
        "down" | "cokenler" => status_text(state, &monitor_ids, true).await?,
        "ssl" => ssl_text(state, &monitor_ids).await?,
        "domains" | "domain" => domains_text(state, &monitor_ids).await?,
        "help" | "start" | "yardim" => help_text(),
        _ => return Ok(()),
    };
    call(state, token, "sendMessage", json!({ "chat_id": chat_id, "text": reply, "disable_web_page_preview": true }), 20).await?;
    Ok(())
}

async fn chat_monitors(state: &AppState, notification_ids: &[i64]) -> Result<HashSet<i64>> {
    let ids = notification_ids.to_vec();
    state
        .db
        .call(move |c| {
            let mut out = HashSet::new();
            let mut st = c.prepare("SELECT monitor_id FROM monitor_notifications WHERE notification_id = ?")?;
            for nid in ids {
                for r in st.query_map([nid], |r| r.get::<_, i64>(0))? {
                    out.insert(r?);
                }
            }
            Ok(out)
        })
        .await
}

fn help_text() -> String {
    pick(
        "Observi commands:\n/status — overview of the monitors in this chat\n/down — monitors that are down\n/ssl — certificates that are expiring or expired\n/domains — domains that are about to expire\n\nAlerts have buttons to mute a monitor or put it under maintenance.",
        "Observi komutları:\n/status — bu sohbetteki monitörlerin özeti\n/down — çöken monitörler\n/ssl — süresi dolan veya dolmak üzere olan sertifikalar\n/domains — süresi dolmak üzere olan alan adları\n\nUyarı mesajlarındaki düğmelerle bir monitörü susturabilir veya bakıma alabilirsin.",
    )
    .to_string()
}

fn human(ms: i64) -> String {
    let s = (ms / 1000).max(0);
    let (d, h, m) = (s / 86400, (s % 86400) / 3600, (s % 3600) / 60);
    match (d, h, m) {
        (0, 0, m) => format!("{m} {}", pick("min", "dk")),
        (0, h, m) => format!("{h} {} {m} {}", pick("h", "sa"), pick("min", "dk")),
        (d, h, _) => format!("{d} {} {h} {}", pick("d", "gün"), pick("h", "sa")),
    }
}

async fn status_text(state: &AppState, ids: &HashSet<i64>, only_down: bool) -> Result<String> {
    let monitors = state.db.call(|c| models::list_monitors(c)).await?;
    let now = now_ms();
    let (mut up, mut down, mut maint, mut paused, mut pending) = (0, 0, 0, 0, 0);
    let mut lines: Vec<String> = Vec::new();
    for m in monitors.iter().filter(|m| ids.contains(&m.id)) {
        let live = state.live.read().unwrap_or_else(|e| e.into_inner()).get(&m.id).cloned();
        let under = state.maintenance_for(m.id).is_some_and(|a| a.kind == Kind::Maintenance);
        let status = if !m.active {
            "paused"
        } else if under {
            "maintenance"
        } else {
            status_str(live.as_ref().and_then(|l| l.status))
        };
        match status {
            "up" => up += 1,
            "down" => down += 1,
            "maintenance" => maint += 1,
            "paused" => paused += 1,
            _ => pending += 1,
        }
        if status == "down" {
            let since = live.as_ref().and_then(|l| l.down_since).map(|t| format!(" — {}", human(now - t))).unwrap_or_default();
            let msg = live.and_then(|l| l.message).unwrap_or_default();
            lines.push(format!("🔴 {}{since}\n    {msg}", m.cfg.name));
        } else if !only_down && status == "maintenance" {
            lines.push(format!("🛠 {}", m.cfg.name));
        }
    }
    let app = state.db.call(|c| crate::brand::get(c)).await.map(|b| b.name).unwrap_or_else(|_| "Observi".into());
    let total = ids.len();
    let mut out = if only_down {
        if down == 0 {
            format!("✅ {}", pick("Nothing is down.", "Çöken bir şey yok."))
        } else {
            format!("🔴 {down} {}", pick("down", "çöktü"))
        }
    } else {
        let mut s = format!("📊 {app}: {total} {}", pick("monitors", "monitör"));
        s.push_str(&format!("\n✅ {up} {}  🔴 {down} {}", pick("up", "çalışıyor"), pick("down", "çöktü")));
        if maint + paused + pending > 0 {
            s.push_str(&format!(
                "\n🛠 {maint} {}  ⏸ {paused} {}  ⏳ {pending} {}",
                pick("maintenance", "bakımda"),
                pick("paused", "durduruldu"),
                pick("pending", "beklemede")
            ));
        }
        s
    };
    if !lines.is_empty() {
        out.push_str("\n\n");
        out.push_str(&lines.join("\n"));
    }
    Ok(out)
}

async fn ssl_text(state: &AppState, ids: &HashSet<i64>) -> Result<String> {
    let now = now_ms();
    let mut items: Vec<(i64, i64)> = state
        .certs
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter(|(id, c)| ids.contains(id) && c.expires_at - now <= 30 * 86_400_000)
        .map(|(id, c)| (*id, c.expires_at))
        .collect();
    items.sort_by_key(|(_, e)| *e);
    let names: HashMap<i64, String> = state
        .db
        .call(|c| Ok(models::list_monitors(c)?.into_iter().map(|m| (m.id, m.cfg.name)).collect()))
        .await?;
    let lines: Vec<String> = items
        .iter()
        .map(|(id, expires)| {
            let name = names.get(id).cloned().unwrap_or_else(|| format!("#{id}"));
            if *expires <= now {
                format!("⛔ {name} — {} {}", pick("expired on", "süresi doldu:"), crate::cert::ymd(*expires))
            } else {
                let days = (expires - now).div_euclid(86_400_000);
                format!("🔐 {name} — {days} {} ({})", pick("days left", "gün kaldı"), crate::cert::ymd(*expires))
            }
        })
        .collect();
    Ok(if lines.is_empty() {
        format!("✅ {}", pick("No certificate expires within 30 days.", "30 gün içinde süresi dolacak sertifika yok."))
    } else {
        lines.join("\n")
    })
}

async fn domains_text(state: &AppState, ids: &HashSet<i64>) -> Result<String> {
    let now = now_ms();
    let monitors = state.db.call(|c| models::list_monitors(c)).await?;
    let mine: HashSet<String> = monitors.iter().filter(|m| ids.contains(&m.id)).filter_map(crate::domain::registrable).collect();
    let domains = state.domains.read().unwrap_or_else(|e| e.into_inner());
    let mut items: Vec<(&String, i64)> = domains
        .iter()
        .filter(|(d, e)| mine.contains(*d) && e.expires_at.is_some_and(|x| x - now <= 60 * 86_400_000))
        .filter_map(|(d, e)| e.expires_at.map(|x| (d, x)))
        .collect();
    items.sort_by_key(|(_, e)| *e);
    let lines: Vec<String> = items
        .iter()
        .map(|(d, e)| {
            if *e <= now {
                format!("⛔ {d} — {} {}", pick("expired on", "süresi doldu:"), crate::cert::ymd(*e))
            } else {
                format!("🌐 {d} — {} {} ({})", (e - now).div_euclid(86_400_000), pick("days left", "gün kaldı"), crate::cert::ymd(*e))
            }
        })
        .collect();
    Ok(if lines.is_empty() {
        format!("✅ {}", pick("No domain expires within 60 days.", "60 gün içinde süresi dolacak alan adı yok."))
    } else {
        lines.join("\n")
    })
}

async fn handle_callback(state: &AppState, token: &str, cb: &Value) -> Result<()> {
    let id = cb["id"].as_str().unwrap_or_default().to_string();
    let data = cb["data"].as_str().unwrap_or_default();
    let chat_id = cb["message"]["chat"]["id"].as_i64().unwrap_or_default().to_string();
    let message_id = cb["message"]["message_id"].as_i64().unwrap_or_default();
    let who = person(cb);

    let mut parts = data.split(':');
    let (action, monitor_id, minutes) = (
        parts.next().unwrap_or(""),
        parts.next().and_then(|v| v.parse::<i64>().ok()),
        parts.next().and_then(|v| v.parse::<i64>().ok()),
    );
    let (Some(monitor_id), Some(minutes)) = (monitor_id, minutes) else {
        call(state, token, "answerCallbackQuery", json!({ "callback_query_id": id }), 10).await.ok();
        return Ok(());
    };
    let kind = match action {
        "mute" => Kind::Mute,
        "maint" => Kind::Maintenance,
        _ => return Ok(()),
    };

    // Only chats configured as channels, and only monitors attached to them.
    let (tok, cid) = (token.to_string(), chat_id.clone());
    let chats = state.db.call(|c| load_chats(c)).await?;
    let nids: Vec<i64> = chats.iter().filter(|c| c.token == tok && c.chat_id == cid).map(|c| c.notification_id).collect();
    if nids.is_empty() || !chat_monitors(state, &nids).await?.contains(&monitor_id) {
        call(state, token, "answerCallbackQuery", json!({ "callback_query_id": id, "text": "Not allowed" }), 10).await.ok();
        return Ok(());
    }

    let minutes = minutes.clamp(1, 7 * 24 * 60);
    let actor = format!("telegram:{who}");
    let a2 = actor.clone();
    let name = state
        .db
        .call(move |c| {
            maintenance::create_quick(c, kind, &[monitor_id], minutes, &a2)?;
            Ok(c.query_row("SELECT name FROM monitors WHERE id = ?", [monitor_id], |r| r.get::<_, String>(0)).unwrap_or_default())
        })
        .await?;
    maintenance::refresh(state).await;

    audit::record_external(
        state,
        &actor,
        Entry {
            action: if kind == Kind::Mute { "telegram.mute".into() } else { "telegram.maintenance".into() },
            target_type: Some("monitor"),
            target_id: Some(monitor_id),
            target_name: Some(name.clone()),
            details: Some(json!({ "minutes": minutes })),
            on_error: false,
        },
    )
    .await;

    let dur = human(minutes * 60_000);
    let label = match kind {
        Kind::Mute => format!("🔕 {} {dur} — {who}", pick("Muted for", "Susturuldu:")),
        Kind::Maintenance => format!("🛠 {} {dur} — {who}", pick("Maintenance for", "Bakımda:")),
    };
    call(state, token, "answerCallbackQuery", json!({ "callback_query_id": id, "text": label }), 10).await.ok();
    call(
        state,
        token,
        "editMessageReplyMarkup",
        json!({
            "chat_id": chat_id,
            "message_id": message_id,
            "reply_markup": { "inline_keyboard": [[{ "text": label, "callback_data": "noop:0:0" }]] }
        }),
        10,
    )
    .await
    .ok();
    Ok(())
}

/// Inline keyboard for a down alert.
pub fn alert_buttons(monitor_id: i64) -> Value {
    json!({
        "inline_keyboard": [
            [
                { "text": pick("🔕 Mute 1 h", "🔕 1 saat sustur"), "callback_data": format!("mute:{monitor_id}:60") },
                { "text": pick("🔕 Mute 24 h", "🔕 24 saat sustur"), "callback_data": format!("mute:{monitor_id}:1440") },
            ],
            [
                { "text": pick("🛠 Maintenance 1 h", "🛠 1 saat bakım"), "callback_data": format!("maint:{monitor_id}:60") },
            ],
        ]
    })
}

/// `/link CODE` or `/start CODE` (deep link) → the code.
fn link_code(text: &str) -> Option<String> {
    let mut parts = text.split_whitespace();
    let cmd = parts.next()?.trim_start_matches('/').split('@').next()?.to_lowercase();
    if cmd != "link" && cmd != "start" {
        return None;
    }
    let code = parts.next()?.trim().to_lowercase();
    (code.len() >= 8 && code.chars().all(|c| c.is_ascii_hexdigit())).then_some(code)
}

/// Attach the private chat to the user the code was issued for; returns the user's name.
async fn link_chat(state: &AppState, code: &str, chat_id: &str) -> Result<Option<String>> {
    let (code, chat_id) = (code.to_string(), chat_id.to_string());
    state
        .db
        .call(move |c| {
            let row: Option<(i64, String)> = c
                .query_row(
                    "SELECT u.id, u.name FROM telegram_links l JOIN users u ON u.id = l.user_id WHERE l.code = ? AND l.expires_at > ?",
                    rusqlite::params![code, crate::db::now_ms()],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();
            let Some((id, name)) = row else { return Ok(None) };
            c.execute("UPDATE users SET telegram_chat_id = ? WHERE id = ?", rusqlite::params![chat_id, id])?;
            c.execute("DELETE FROM telegram_links WHERE user_id = ?", [id])?;
            Ok(Some(name))
        })
        .await
}

/// The bot token of the first Telegram channel (the bot that talks to users).
pub fn bot_token(c: &rusqlite::Connection) -> Result<Option<String>> {
    Ok(load_chats(c)?.into_iter().map(|c| c.token).find(|t| !t.is_empty()))
}

pub async fn bot_username(state: &AppState, token: &str) -> Option<String> {
    call(state, token, "getMe", json!({}), 10).await.ok()?["result"]["username"].as_str().map(str::to_string)
}

/// Send a private message through the bot.
pub async fn send_private(state: &AppState, token: &str, chat_id: &str, text: &str) -> Result<()> {
    call(state, token, "sendMessage", json!({ "chat_id": chat_id, "text": text, "disable_web_page_preview": true }), 20).await?;
    Ok(())
}
