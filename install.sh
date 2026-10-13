#!/usr/bin/env bash
# Observi installer for Linux servers and Raspberry Pi (systemd required).
#
#   curl -fsSL https://raw.githubusercontent.com/mdenizay/observi/main/install.sh | sudo bash
#   curl -fsSL .../install.sh | sudo bash -s -- --lang tr --listen 0.0.0.0:3001
#
# Re-running the script upgrades an existing install and keeps its data.
set -euo pipefail

REPO="mdenizay/observi"
BIN="/usr/local/bin/observi"
SVC_USER="observi"
DATA_DIR="/var/lib/observi"
CONF_DIR="/etc/observi"
ENV_FILE="$CONF_DIR/observi.env"
UNIT="/etc/systemd/system/observi.service"

VERSION="latest"
LISTEN=""
LANG_OPT=""
ADMIN_USER="admin"
ADMIN_PASSWORD="${OBSERVI_PASSWORD:-}"
CREATE_ADMIN=1
UNINSTALL=0
PURGE=0

usage() {
  cat <<EOF
Observi installer

Options:
  --version <vX.Y.Z>        Install a specific release (default: latest)
  --listen <addr:port>      Listen address (default: 127.0.0.1:3001 on a fresh install)
  --lang <en|tr>            Language of notifications (default: en on a fresh install)
  --admin-user <name>       Username of the first superadmin (default: admin)
  --admin-password <pass>   Password of the first superadmin (default: generated, min. 8 chars)
  --no-admin                Do not create it now (the server then creates 'admin' on
                            first start and writes the password to the journal)
  --uninstall               Remove the service and binary (keeps your data)
  --purge                   With --uninstall: also delete data, config and the service user
  -h, --help                Show this help
EOF
}

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version)        VERSION="${2:?--version needs a value}"; shift 2 ;;
    --listen)         LISTEN="${2:?--listen needs a value}"; shift 2 ;;
    --lang)           LANG_OPT="${2:?--lang needs a value}"; shift 2 ;;
    --admin-user)     ADMIN_USER="${2:?--admin-user needs a value}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:?--admin-password needs a value}"; shift 2 ;;
    --no-admin)       CREATE_ADMIN=0; shift ;;
    --uninstall)      UNINSTALL=1; shift ;;
    --purge)          PURGE=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *)                usage >&2; die "unknown option: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "please run as root (e.g. prefix with sudo)"
[ "$(uname -s)" = "Linux" ] || die "Observi supports Linux only"
command -v systemctl >/dev/null 2>&1 || die "systemd is required"

if [ "$UNINSTALL" -eq 1 ]; then
  say "Stopping and removing the service"
  systemctl disable --now observi >/dev/null 2>&1 || true
  rm -f "$UNIT" "$BIN"
  systemctl daemon-reload
  if [ "$PURGE" -eq 1 ]; then
    rm -rf "$DATA_DIR" "$CONF_DIR"
    if id "$SVC_USER" >/dev/null 2>&1; then userdel "$SVC_USER" 2>/dev/null || true; fi
    say "Removed data, config and the '$SVC_USER' user"
  else
    say "Kept $DATA_DIR and $CONF_DIR (use --purge to delete them)"
  fi
  exit 0
fi

# ---- platform ---------------------------------------------------------------
case "$(uname -m)" in
  x86_64|amd64)  ARCH="x86_64" ;;
  aarch64|arm64) ARCH="aarch64" ;;
  armv7l|armv6l) die "32-bit ARM is not supported. On a Raspberry Pi use the 64-bit OS (Raspberry Pi 3/4/5/Zero 2 W)." ;;
  *)             die "unsupported architecture: $(uname -m) (supported: x86_64, aarch64)" ;;
esac

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "curl or wget is required"
fi
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"
command -v tar >/dev/null 2>&1 || die "tar is required"

# ---- download ---------------------------------------------------------------
ASSET="observi-linux-${ARCH}.tar.gz"
if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "Downloading $ASSET ($VERSION)"
fetch "$BASE/$ASSET" "$TMP/$ASSET" || die "download failed: $BASE/$ASSET"
fetch "$BASE/$ASSET.sha256" "$TMP/$ASSET.sha256" || die "checksum download failed"
(cd "$TMP" && sha256sum -c "$ASSET.sha256" >/dev/null) || die "checksum verification failed"
tar -xzf "$TMP/$ASSET" -C "$TMP"
[ -f "$TMP/observi" ] || die "archive does not contain the observi binary"

# ---- install ----------------------------------------------------------------
UPGRADE=0
if [ -x "$BIN" ]; then UPGRADE=1; fi

if ! id "$SVC_USER" >/dev/null 2>&1; then
  say "Creating system user '$SVC_USER'"
  NOLOGIN="$(command -v nologin || echo /usr/sbin/nologin)"
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell "$NOLOGIN" "$SVC_USER"
fi

install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 "$DATA_DIR"
install -d -m 0755 "$CONF_DIR"

# Binary: stop the service first so a running binary can be replaced safely.
systemctl stop observi >/dev/null 2>&1 || true
install -m 0755 "$TMP/observi" "$BIN"

set_env() { # KEY VALUE — add or replace a line in the env file
  if grep -q "^$1=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    echo "$1=$2" >> "$ENV_FILE"
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  : > "$ENV_FILE"
  set_env OBSERVI_DB "$DATA_DIR/observi.db"
  set_env OBSERVI_LISTEN "${LISTEN:-127.0.0.1:3001}"
  set_env OBSERVI_LANG "${LANG_OPT:-en}"
  set_env OBSERVI_RETENTION 90
else
  if [ -n "$LISTEN" ]; then set_env OBSERVI_LISTEN "$LISTEN"; fi
  if [ -n "$LANG_OPT" ]; then set_env OBSERVI_LANG "$LANG_OPT"; fi
fi
chmod 0644 "$ENV_FILE"
# shellcheck disable=SC1090
DB_PATH="$(. "$ENV_FILE"; echo "${OBSERVI_DB:-$DATA_DIR/observi.db}")"
LISTEN_ADDR="$(. "$ENV_FILE"; echo "${OBSERVI_LISTEN:-127.0.0.1:3001}")"

cat > "$UNIT" <<EOF
[Unit]
Description=Observi uptime monitor
Documentation=https://github.com/$REPO
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
EnvironmentFile=$ENV_FILE
ExecStart=$BIN serve
WorkingDirectory=$DATA_DIR
Restart=always
RestartSec=3

# Hardening
StateDirectory=observi
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryMax=256M

[Install]
WantedBy=multi-user.target
EOF

# ---- first superadmin (fresh database only) ---------------------------------
GENERATED=""
if [ "$CREATE_ADMIN" -eq 1 ] && [ ! -e "$DB_PATH" ]; then
  say "Creating superadmin '$ADMIN_USER'"
  if [ -n "$ADMIN_PASSWORD" ] && [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
    die "the admin password must be at least 8 characters"
  fi
  run_as_svc() {
    if command -v runuser >/dev/null 2>&1; then runuser -u "$SVC_USER" -- "$@"
    else su -s /bin/sh "$SVC_USER" -c "$(printf '%q ' "$@")"; fi
  }
  OUT="$(run_as_svc env OBSERVI_DB="$DB_PATH" OBSERVI_PASSWORD="$ADMIN_PASSWORD" "$BIN" user-add "$ADMIN_USER" "Administrator" superadmin)"
  if [ -z "$ADMIN_PASSWORD" ]; then GENERATED="$(printf '%s\n' "$OUT" | sed -n 's/^Password: //p')"; fi
fi

# ---- start ------------------------------------------------------------------
systemctl daemon-reload
systemctl enable observi >/dev/null 2>&1
systemctl restart observi

say "Waiting for Observi to start"
HOSTPORT="$LISTEN_ADDR"
case "$HOSTPORT" in 0.0.0.0:*|\[::\]:*) HOSTPORT="127.0.0.1:${HOSTPORT##*:}" ;; esac
UP=0
for _ in $(seq 1 20); do
  CODE="$( (curl -s -o /dev/null -w '%{http_code}' "http://$HOSTPORT/api/auth/me" 2>/dev/null || true) )"
  if [ "$CODE" = "401" ]; then UP=1; break; fi
  sleep 1
done
if [ "$UP" -ne 1 ]; then
  warn "the service did not answer in time; check: journalctl -u observi -n 50"
fi

echo
if [ "$UPGRADE" -eq 1 ]; then say "Observi upgraded ($("$BIN" --version 2>/dev/null || echo "$VERSION"))"; else say "Observi installed"; fi
echo "  URL:      http://$LISTEN_ADDR"
if [ -n "$GENERATED" ]; then
  echo "  Username: $ADMIN_USER"
  echo "  Password: $GENERATED   (shown once — change it under Settings)"
elif [ "$CREATE_ADMIN" -eq 1 ] && [ -n "$ADMIN_PASSWORD" ] && [ "$UPGRADE" -eq 0 ]; then
  echo "  Username: $ADMIN_USER"
fi
echo
echo "  Status:   systemctl status observi"
echo "  Logs:     journalctl -u observi -f"
echo "  Config:   $ENV_FILE   (then: systemctl restart observi)"
echo "  Upgrade:  re-run this script"
echo "  Remove:   install.sh --uninstall [--purge]"
case "$LISTEN_ADDR" in
  127.0.0.1:*|localhost:*)
    echo
    echo "  Observi only listens on localhost. Put it behind a reverse proxy (nginx, Caddy)"
    echo "  or a Cloudflare Tunnel, or re-run with --listen 0.0.0.0:3001 for LAN access."
    ;;
esac
