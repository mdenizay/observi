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
- **Live dashboard** over Server-Sent Events, response-time charts, 24h / 7d / 30d uptime
- **Notifications** via Telegram, SMTP e-mail and webhooks (generic JSON, Discord, Slack)
- **English and Turkish** UI (language switcher in the app); notification language is configurable
- **Frugal by design** — SQLite in WAL mode, batched heartbeat writes (gentle on SD cards),
  one task per monitor, no polling in the browser
- Safe defaults: Argon2 password hashes, HttpOnly session cookies, login throttling,
  hardened systemd unit

## Install

Works on Linux servers (x86_64) and Raspberry Pi (64-bit OS: Pi 3/4/5, Zero 2 W)
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
| `RUST_LOG` | `info` | Log level |

## Command line

```text
observi serve                                  start the server (default)
observi user-add <username> <name> [superadmin|user]
observi passwd <username>                      reset a password
observi import-kuma <kuma.db>                  import monitors from Uptime Kuma
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
