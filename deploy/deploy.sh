#!/usr/bin/env bash
# Developer helper: build the UI locally, sync the sources to a host over SSH,
# compile there and restart the service. For normal installs use install.sh.
#
# Usage: deploy/deploy.sh user@host
set -euo pipefail

HOST="${1:?usage: deploy/deploy.sh user@host}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

(cd "$ROOT/web" && pnpm install --frozen-lockfile && pnpm build)
rsync -az --delete --exclude target --exclude 'web/node_modules' --exclude '*.db*' \
  --exclude '*password*' --exclude .local --exclude .git "$ROOT/" "$HOST:observi-src/"
ssh "$HOST" 'set -e
  cd ~/observi-src && touch src/web.rs && ~/.cargo/bin/cargo build --release
  sudo install -m 755 target/release/observi /usr/local/bin/observi
  sudo systemctl restart observi
  sleep 1; systemctl is-active observi'
