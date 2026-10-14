# Observi

A lightweight, self-hosted uptime monitor. One small Rust binary with an embedded
React dashboard — no database server, no Node runtime, about **20 MB of RAM**.
It runs happily on a Raspberry Pi.

> An alternative to Uptime Kuma if you want something that is lean, fast to start
> and easy to run on tiny machines. Your existing Uptime Kuma monitors can be
> imported with one command.

## Features

- **HTTP(s), keyword and TCP port monitors** with retries and a *pending* state
  before a monitor is declared down
- **Multiple accounts and roles** — `superadmin` manages everything; regular users
  only see the monitors (or whole **groups** of monitors) you grant them
- **Live dashboard** over Server-Sent Events with grid and list views, response-time charts,
  24h / 7d / 30d uptime, a 30-day uptime strip and incident history
- **Command palette** (⌘K / Ctrl+K) to jump to any monitor or page, plus keyboard shortcuts
- **Maintenance windows and mute** — one-off or weekly recurring; monitors show as "under maintenance"
  (no alerts, excluded from uptime) or keep their status with notifications held back
- **Domain expiry monitoring** — registration expiry via RDAP/WHOIS (including `.com.tr` / `.org.tr`), with
  warnings at 60, 30, 14, 7 and 1 days
- **Uptime reports** — per-monitor uptime, incidents and downtime over 7/30/90 days with CSV export, plus
  scheduled **weekly and monthly digests** sent through your notification channels
- **Tags and templates** — label monitors, filter by tag, and start new monitors from presets (Laravel `/up`,
  WordPress, TCP services, …)
- **Telegram interaction** — mute or put a monitor under maintenance from the alert's buttons, and ask
  `/status`, `/down`, `/ssl`, `/domains` in the chat (long polling, nothing exposed publicly)
- **Audit log** of who changed what, including failed logins
- **Status heat map** on the dashboard (24h / 7d / 30d, one row per monitor) and a customizable dashboard: show, hide and reorder widgets, saved to your account
- **Account security** — two-factor authentication (TOTP with recovery codes), **passkeys**, session management,
  admin-issued password reset links and per-user **API tokens**
- **SSL certificate monitoring** — HTTPS monitors show the certificate's expiry date; a distinct
  indicator appears when it is about to expire, and warnings go out through your notification channels
  14, 7, 3 and 1 days before expiry, when it expires, and when it is renewed
  (a site that still answers with a bad certificate is reported as up, not down)
- **Notifications** via Telegram, SMTP e-mail and webhooks (generic JSON, Discord, Slack)
- **Updates** — the dashboard notifies superadmins about new releases; one-click or fully automatic
  updates on systemd installs (`install.sh`), `docker compose pull` instructions for Docker
- **White-label**: set your own product name and logo in Settings
- **English and Turkish** UI (language switcher in the app); notification language is configurable
- **Frugal by design** — SQLite in WAL mode, batched heartbeat writes (gentle on SD cards),
  one task per monitor, no polling in the browser
- Safe defaults: Argon2 password hashes, HttpOnly session cookies, login throttling,
  hardened systemd unit

## Install

Use the install script (systemd) or [Docker](#docker).

The script works on Linux servers (x86_64) and Raspberry Pi (64-bit OS: Pi 3/4/5, Zero 2 W)
— anything with **systemd**:

```bash
curl -fsSL https://raw.githubusercontent.com/mdenizay/observi/main/install.sh | sudo bash
```

The script downloads the matching release binary, verifies its checksum, creates an
`observi` system user, installs and starts a systemd service, and creates the first
superadmin (`admin`, with a generated password that is printed once).

Useful options (`--listen` defaults to `127.0.0.1:3001`, i.e. localhost only; `--lang` sets the
language of notifications, `en` or `tr`):

```bash
curl -fsSL https://raw.githubusercontent.com/mdenizay/observi/main/install.sh | sudo bash -s -- \
  --listen 0.0.0.0:3001 --lang tr --admin-user me --admin-password 'a-long-password'
```

Re-running the script **upgrades** an existing install and keeps your data.
`install.sh --uninstall` removes the service (add `--purge` to delete data too).

Where things live: binary `/usr/local/bin/observi`, data `/var/lib/observi`,
configuration `/etc/observi/observi.env`.

### Docker

Multi-arch images (amd64, arm64 — Raspberry Pi included) are published to GitHub Container Registry:

```bash
docker run -d --name observi -p 3001:3001 -v observi-data:/data \
  --restart unless-stopped ghcr.io/mdenizay/observi:latest
docker logs observi 2>&1 | grep password     # generated superadmin password (first start only)
```

Or with Compose — see [`docker-compose.yml`](docker-compose.yml):

```bash
docker compose up -d
```

The image is a static binary on distroless (runs as a non-root user, a few MB). Data lives in the
`/data` volume. Set `OBSERVI_ADMIN_USER` / `OBSERVI_ADMIN_PASSWORD` to choose the first superadmin
instead of a generated one; they are only used when the database has no users. Manage users with
`docker exec -it observi observi user-add <username> <name> superadmin`. Upgrade with
`docker compose pull && docker compose up -d`. To build the image yourself: `docker build -t observi .`

### Exposing it

By default Observi listens on `127.0.0.1:3001`. Put it behind a reverse proxy or a tunnel:

```caddyfile
# Caddy
status.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```nginx
# nginx (SSE needs buffering off)
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_buffering off;
}
```

A Cloudflare Tunnel pointing at `http://localhost:3001` works too (this is how the
author runs it on a Raspberry Pi at home). Make sure your proxy sends
`X-Forwarded-Proto` so session cookies get the `Secure` flag, and
`CF-Connecting-IP` / `X-Forwarded-For` so login throttling sees real client IPs.

## Configuration

Environment variables (set them in `/etc/observi/observi.env`, then
`sudo systemctl restart observi`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `OBSERVI_DB` | `./observi.db` | SQLite database path |
| `OBSERVI_LISTEN` | `127.0.0.1:3001` | Listen address |
| `OBSERVI_RETENTION` | `90` | Heartbeat retention in days |
| `OBSERVI_LANG` | `en` | Language of notifications: `en` or `tr` |
| `OBSERVI_ADMIN_USER` / `OBSERVI_ADMIN_PASSWORD` | `admin` / generated | First superadmin, created only when the database has no users |
| `OBSERVI_PUBLIC_URL` | derived from the request | Public URL (e.g. `https://status.example.com`); pins the passkey relying party behind proxies |
| `OBSERVI_UPDATE_CHECK` | `1` | Set to `0` to stop checking GitHub for new releases |
| `RUST_LOG` | `info` | Log level |

## Command line

```text
observi serve                                  start the server (default)
observi user-add <username> <name> [superadmin|user]
observi passwd <username>                      reset a password
observi import-kuma <kuma.db>                  import monitors from Uptime Kuma
observi health                                 exit 0 if the local server responds
observi --version
```

Passwords for `user-add` / `passwd` come from `OBSERVI_PASSWORD` or are generated and printed.
On a system installed with `install.sh`, run them as the service user:

```bash
sudo -u observi env OBSERVI_DB=/var/lib/observi/observi.db observi passwd admin
```

### Migrating from Uptime Kuma

Copy `kuma.db` (together with its `-wal`/`-shm` files if present) somewhere readable and run
`observi import-kuma kuma.db`. HTTP, keyword and TCP-port monitors are imported
(read-only access to your Kuma database); notification settings are not.

## Build from source

Requirements: Rust (stable), Node 20+ and pnpm. The web UI is embedded into the binary at
compile time, so build it first:

```bash
cd web && pnpm install --frozen-lockfile && pnpm build && cd ..
cargo build --release          # → target/release/observi
```

For a portable static binary (what the releases use):
`rustup target add x86_64-unknown-linux-musl` (or `aarch64-…`), install `musl-tools`, and add
`--target <triple>`.

### Development

```bash
cd web && pnpm install && pnpm dev       # UI on :5173, proxies /api to :3001
OBSERVI_PASSWORD=changeme123 cargo run -- user-add admin Admin superadmin
cargo run                                # API on 127.0.0.1:3001
cargo test && cargo clippy --all-targets
```

## Project layout

```text
src/            Rust backend (axum, tokio, rusqlite, reqwest, rustls)
  api.rs        REST API + live events (SSE)
  scheduler.rs  per-monitor check loops, state machine, batched writer
  check.rs      HTTP / keyword / TCP checks
  notify.rs     Telegram / SMTP / webhook delivery
web/            React + Vite + Tailwind + shadcn/ui-style components
docs/API.md     HTTP API reference
install.sh      installer / upgrader
```

## License

[MIT](LICENSE)
