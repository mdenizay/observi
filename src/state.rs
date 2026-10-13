use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};

use serde::Serialize;
use tokio::sync::{broadcast, mpsc, watch};

use crate::auth::LoginThrottle;
use crate::db::Db;
use crate::scheduler::Scheduler;

pub const DOWN: u8 = 0;
pub const UP: u8 = 1;
pub const PENDING: u8 = 2;
pub const PAUSED: u8 = 3;

/// Number of recent beats kept in memory per monitor.
pub const RECENT_BEATS: usize = 60;

#[derive(Debug, Clone, Serialize)]
pub struct Beat {
    pub t: i64,
    pub s: u8,
    pub l: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub m: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct MonitorLive {
    pub status: Option<u8>,
    pub latency: Option<u32>,
    pub last_check: Option<i64>,
    pub message: Option<String>,
    pub beats: VecDeque<Beat>,
    /// Consecutive failures while not yet DOWN.
    pub retries: u32,
    /// When the monitor went down (for "down for X" in recovery notifications).
    pub down_since: Option<i64>,
}

impl MonitorLive {
    pub fn push(&mut self, beat: Beat) {
        self.status = Some(beat.s);
        self.last_check = Some(beat.t);
        self.latency = beat.l;
        self.message = beat.m.clone();
        if self.beats.len() >= RECENT_BEATS {
            self.beats.pop_front();
        }
        self.beats.push_back(beat);
    }
}

pub fn status_str(s: Option<u8>) -> &'static str {
    match s {
        Some(DOWN) => "down",
        Some(UP) => "up",
        Some(PENDING) => "pending",
        Some(PAUSED) => "paused",
        _ => "unknown",
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BeatEvent {
    pub monitor_id: i64,
    #[serde(flatten)]
    pub beat: Beat,
    pub status: &'static str,
}

#[derive(Debug, Clone)]
pub enum Event {
    Beat(BeatEvent),
    MonitorsChanged,
}

/// A heartbeat queued for the batched DB writer.
pub struct BeatRecord {
    pub monitor_id: i64,
    pub beat: Beat,
    pub important: bool,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub live: Arc<RwLock<HashMap<i64, MonitorLive>>>,
    /// Cached 24h uptime percentages, refreshed periodically.
    pub uptime24: Arc<RwLock<HashMap<i64, f64>>>,
    pub events: broadcast::Sender<Event>,
    pub writer: mpsc::Sender<BeatRecord>,
    pub scheduler: Arc<Scheduler>,
    pub throttle: Arc<LoginThrottle>,
    /// Client for outgoing notifications (pooled).
    pub http: reqwest::Client,
    pub clients: Arc<crate::check::Clients>,
    /// Flips to true on shutdown so long-lived SSE streams end and the server can drain.
    pub shutdown: Arc<watch::Sender<bool>>,
    pub updater: Arc<crate::update::Updater>,
}

impl AppState {
    pub fn notify_monitors_changed(&self) {
        let _ = self.events.send(Event::MonitorsChanged);
    }
}
