//! Update checks and self-update.
//!
//! The server (unprivileged) only *checks* GitHub for new releases and, when an
//! update is approved, drops a request file into its data directory. On systemd
//! installs a root-owned path unit (installed by install.sh) notices the file and
//! runs `observi self-update`, which downloads the release, verifies its
//! checksum, swaps the binary and restarts the service.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::now_ms;
use crate::models::{get_setting, set_setting};
use crate::state::AppState;

pub const CURRENT: &str = env!("CARGO_PKG_VERSION");
const REQUEST_FILE: &str = "update-request";
const RESULT_FILE: &str = "update-result.json";
const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);
/// How long to wait for the privileged updater to pick up a request.
const PICKUP_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Systemd,
    Docker,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Idle,
    Checking,
    Updating,
    Error,
}

#[derive(Debug, Clone, Default)]
struct Release {
    tag: String,
    url: String,
    published_at: Option<i64>,
    notes: Option<String>,
}

struct Inner {
    latest: Option<Release>,
    checked_at: Option<i64>,
    phase: Phase,
    error: Option<String>,
}

pub struct Updater {
    inner: RwLock<Inner>,
    mode: Mode,
    repo: String,
    data_dir: PathBuf,
    checks_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateResult {
    pub ok: bool,
    pub version: String,
    pub error: Option<String>,
    pub at: i64,
}

#[derive(Serialize)]
pub struct Status {
    current: &'static str,
    latest: Option<String>,
    available: bool,
    release_url: Option<String>,
    published_at: Option<i64>,
    notes: Option<String>,
    checked_at: Option<i64>,
    auto_update: bool,
    mode: Mode,
    can_apply: bool,
    state: Phase,
    error: Option<String>,
    last_result: Option<UpdateResult>,
}

pub fn repo() -> String {
    std::env::var("OBSERVI_UPDATE_REPO").unwrap_or_else(|_| "mdenizay/observi".into())
}

/// Parse "v1.2.3" / "1.2.3" into a comparable tuple; pre-releases are ignored.
pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let v = v.trim().trim_start_matches('v');
    if v.contains('-') {
        return None;
    }
    let mut it = v.split('.').map(|p| p.parse::<u64>().ok());
    let r = (it.next()??, it.next()??, it.next()??);
    it.next().is_none().then_some(r)
}

fn is_newer(candidate: &str, current: &str) -> bool {
    matches!((parse_version(candidate), parse_version(current)), (Some(a), Some(b)) if a > b)
}

/// Minimal RFC 3339 parser for GitHub timestamps ("2026-10-13T16:21:33Z").
fn parse_rfc3339(s: &str) -> Option<i64> {
    let (date, time) = s.trim_end_matches('Z').split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let mut t = time.split(':').map(|p| p.split('.').next().and_then(|x| x.parse::<i64>().ok()));
    let (hh, mm, ss) = (t.next()??, t.next()??, t.next()??);
    Some(crate::cert::unix_ms(y, m, day, hh, mm, ss))
}

impl Updater {
    pub fn new(db_path: &str) -> Self {
        let mode = match std::env::var("OBSERVI_UPDATER").as_deref() {
            Ok("systemd") => Mode::Systemd,
            Ok("docker") => Mode::Docker,
            _ => Mode::Manual,
        };
        let data_dir = Path::new(db_path)
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        Updater {
            inner: RwLock::new(Inner { latest: None, checked_at: None, phase: Phase::Idle, error: None }),
            mode,
            repo: repo(),
            data_dir,
            checks_enabled: std::env::var("OBSERVI_UPDATE_CHECK").map(|v| v != "0").unwrap_or(true),
        }
    }

    fn can_apply(&self) -> bool {
        self.mode == Mode::Systemd
    }

    fn last_result(&self) -> Option<UpdateResult> {
        let raw = std::fs::read_to_string(self.data_dir.join(RESULT_FILE)).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn status(&self, auto_update: bool) -> Status {
        let inner = self.inner.read().unwrap_or_else(|e| e.into_inner());
        let latest = inner.latest.clone();
        Status {
            current: CURRENT,
            available: latest.as_ref().is_some_and(|r| is_newer(&r.tag, CURRENT)),
            latest: latest.as_ref().map(|r| r.tag.trim_start_matches('v').to_string()),
            release_url: latest.as_ref().map(|r| r.url.clone()),
            published_at: latest.as_ref().and_then(|r| r.published_at),
            notes: latest.and_then(|r| r.notes),
            checked_at: inner.checked_at,
            auto_update,
            mode: self.mode,
            can_apply: self.can_apply(),
            state: inner.phase,
            error: inner.error.clone(),
            last_result: self.last_result(),
        }
    }

    fn set_phase(&self, phase: Phase, error: Option<String>) {
        let mut inner = self.inner.write().unwrap_or_else(|e| e.into_inner());
        inner.phase = phase;
        inner.error = error;
    }

    pub async fn check(&self, http: &reqwest::Client) {
        if self.inner.read().unwrap_or_else(|e| e.into_inner()).phase == Phase::Updating {
            return;
        }
        self.set_phase(Phase::Checking, None);
        match fetch_latest(http, &self.repo).await {
            Ok(rel) => {
                let mut inner = self.inner.write().unwrap_or_else(|e| e.into_inner());
                inner.latest = Some(rel);
                inner.checked_at = Some(now_ms());
                inner.phase = Phase::Idle;
                inner.error = None;
            }
            Err(e) => {
                tracing::warn!("update check failed: {e:#}");
                let mut inner = self.inner.write().unwrap_or_else(|e| e.into_inner());
                inner.checked_at = Some(now_ms());
                inner.phase = Phase::Error;
                inner.error = Some(format!("{e:#}"));
            }
        }
    }

    /// Ask the privileged updater to install the latest known release.
    pub fn apply(&self) -> Result<(), &'static str> {
        if !self.can_apply() {
            return Err("update_not_supported");
        }
        let tag = {
            let inner = self.inner.read().unwrap_or_else(|e| e.into_inner());
            if inner.phase == Phase::Updating {
                return Err("update_in_progress");
            }
            match &inner.latest {
                Some(r) if is_newer(&r.tag, CURRENT) => r.tag.clone(),
                _ => return Err("no_update"),
            }
        };
        let tmp = self.data_dir.join(format!("{REQUEST_FILE}.tmp"));
        let path = self.data_dir.join(REQUEST_FILE);
        if std::fs::write(&tmp, &tag).and_then(|_| std::fs::rename(&tmp, &path)).is_err() {
            self.set_phase(Phase::Error, Some("Could not write the update request".into()));
            return Err("update_not_supported");
        }
        tracing::info!("requested update to {tag}");
        self.set_phase(Phase::Updating, None);
        Ok(())
    }

    /// If the request file is still there after a while, the updater units are
    /// missing or broken: report it instead of spinning forever.
    async fn watch_pickup(&self) {
        tokio::time::sleep(PICKUP_TIMEOUT).await;
        let path = self.data_dir.join(REQUEST_FILE);
        if self.inner.read().unwrap_or_else(|e| e.into_inner()).phase == Phase::Updating && path.exists() {
            let _ = std::fs::remove_file(&path);
            self.set_phase(
                Phase::Error,
                Some("The updater service did not respond. Re-run install.sh to install it.".into()),
            );
        }
    }
}

pub fn auto_update_enabled(c: &rusqlite::Connection) -> bool {
    get_setting(c, "auto_update").ok().flatten().as_deref() == Some("1")
}

pub fn set_auto_update(c: &rusqlite::Connection, on: bool) -> Result<()> {
    set_setting(c, "auto_update", if on { "1" } else { "0" })
}

/// Request an update and watch that the updater picks it up.
pub fn request(state: &AppState) -> Result<(), &'static str> {
    state.updater.apply()?;
    let st = state.clone();
    tokio::spawn(async move { st.updater.watch_pickup().await });
    Ok(())
}

/// Background task: check shortly after start, then every few hours; install
/// automatically when the admin enabled automatic updates.
pub async fn run(state: AppState) {
    if !state.updater.checks_enabled {
        return;
    }
    tokio::time::sleep(Duration::from_secs(60)).await;
    loop {
        state.updater.check(&state.http).await;
        let auto = state.db.call(|c| Ok(auto_update_enabled(c))).await.unwrap_or(false);
        if auto
            && state.updater.status(true).available
            && state.updater.can_apply()
            && let Err(e) = request(&state)
        {
            tracing::warn!("automatic update not started: {e}");
        }
        tokio::time::sleep(CHECK_EVERY).await;
    }
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    html_url: String,
    published_at: Option<String>,
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

async fn fetch_latest(http: &reqwest::Client, repo: &str) -> Result<Release> {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let resp = http
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .context("could not reach GitHub")?;
    if !resp.status().is_success() {
        bail!("GitHub returned HTTP {}", resp.status().as_u16());
    }
    let r: GhRelease = resp.json().await.context("unexpected GitHub response")?;
    if r.draft || r.prerelease || parse_version(&r.tag_name).is_none() {
        bail!("latest release {} is not a stable version", r.tag_name);
    }
    let notes = r.body.map(|b| b.chars().take(8000).collect::<String>()).filter(|b| !b.trim().is_empty());
    Ok(Release {
        tag: r.tag_name,
        url: r.html_url,
        published_at: r.published_at.as_deref().and_then(parse_rfc3339),
        notes,
    })
}

// ---------- `observi self-update` (runs as root via observi-update.service) ----------

pub struct SelfUpdateArgs {
    pub version: Option<String>,
    pub request: Option<PathBuf>,
    pub restart: bool,
}

pub fn self_update(args: SelfUpdateArgs) -> Result<()> {
    let mut version = args.version;
    let mut result_dir = None;
    if let Some(req) = &args.request {
        // Remove the trigger first so the path unit can never loop on it.
        let content = std::fs::read_to_string(req).unwrap_or_default();
        let _ = std::fs::remove_file(req);
        version = Some(content.trim().to_string()).filter(|v| !v.is_empty()).or(version);
        result_dir = req.parent().map(Path::to_path_buf);
    }

    let outcome = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(install(version));

    let (ok, ver, err) = match &outcome {
        Ok(v) => (true, v.clone(), None),
        Err(e) => (false, String::new(), Some(format!("{e:#}"))),
    };
    if let Some(dir) = result_dir {
        let res = UpdateResult { ok, version: ver.trim_start_matches('v').to_string(), error: err, at: now_ms() };
        if let Ok(json) = serde_json::to_string(&res) {
            let _ = std::fs::write(dir.join(RESULT_FILE), json);
        }
    }
    let installed = outcome?;
    println!("Installed observi {installed}");
    if args.restart {
        let status = std::process::Command::new("systemctl").args(["restart", "observi"]).status()?;
        if !status.success() {
            bail!("systemctl restart observi failed");
        }
    }
    Ok(())
}

async fn install(version: Option<String>) -> Result<String> {
    let repo = repo();
    let http = reqwest::Client::builder().user_agent(concat!("Observi/", env!("CARGO_PKG_VERSION"))).build()?;
    let tag = match version {
        Some(v) => v,
        None => fetch_latest(&http, &repo).await?.tag,
    };
    // The tag ends up in a URL and a file name: only accept plain versions.
    if parse_version(&tag).is_none() {
        bail!("invalid version {tag:?}");
    }
    let tag = if tag.starts_with('v') { tag } else { format!("v{tag}") };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => bail!("no release build for architecture {other}"),
    };
    let asset = format!("observi-linux-{arch}.tar.gz");
    let base = format!("https://github.com/{repo}/releases/download/{tag}");

    let get = |url: String| {
        let http = http.clone();
        async move {
            let resp = http.get(&url).timeout(Duration::from_secs(300)).send().await?.error_for_status()?;
            anyhow::Ok(resp.bytes().await?)
        }
    };
    let archive = get(format!("{base}/{asset}")).await.context("download failed")?;
    let sums = get(format!("{base}/{asset}.sha256")).await.context("checksum download failed")?;
    let expected = String::from_utf8_lossy(&sums).split_whitespace().next().unwrap_or_default().to_lowercase();
    let actual = hex::encode(Sha256::digest(&archive));
    if expected.len() != 64 || expected != actual {
        bail!("checksum mismatch");
    }

    let mut binary = None;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(&archive[..]));
    for entry in tar.entries()? {
        let mut entry = entry?;
        if entry.path()?.file_name().and_then(|n| n.to_str()) == Some("observi") {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            binary = Some(buf);
            break;
        }
    }
    let binary = binary.context("archive does not contain the observi binary")?;

    let exe = std::env::current_exe()?.canonicalize()?;
    let staged = exe.with_extension("new");
    std::fs::write(&staged, &binary)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
    }
    // Make sure the new binary actually runs on this machine before swapping.
    let probe = std::process::Command::new(&staged).arg("--version").output();
    match probe {
        Ok(out) if out.status.success() && String::from_utf8_lossy(&out.stdout).starts_with("observi ") => {}
        _ => {
            let _ = std::fs::remove_file(&staged);
            bail!("the downloaded binary does not run on this system");
        }
    }
    std::fs::rename(&staged, &exe)?;
    Ok(tag)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("0.10.0"), Some((0, 10, 0)));
        assert_eq!(parse_version("v1.2.3-rc1"), None);
        assert_eq!(parse_version("v1.2"), None);
        assert_eq!(parse_version("../../x"), None);
        assert!(is_newer("v0.10.0", "0.9.9"));
        assert!(!is_newer("v0.5.0", "0.5.0"));
        assert!(!is_newer("v0.4.9", "0.5.0"));
    }

    #[test]
    fn rfc3339() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("2026-10-13T16:21:33Z"), Some(1_791_908_493_000));
    }
}
