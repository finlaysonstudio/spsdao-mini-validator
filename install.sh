#!/bin/sh
# SPS Mini Validator installer.
#
#   curl -fsSL https://raw.githubusercontent.com/finlaysonstudio/spsdao-mini-validator/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --native-install --accounts alice,bob
#
# Options:
#   --docker            run in Docker (default; image ghcr.io/finlaysonstudio/spsdao-mini-validator)
#   --native-install    install the sps-mini-validator CLI with npm (Node 24+) and a systemd/launchd service
#   --genesis           start from the genesis seed (block 93703455) and replay to head (hours, ~6 GB
#                       chunk cache) instead of the latest published seed
#   --accounts a,b      validator accounts to perform duties for; add their posting key(s) as
#                       VALIDATOR_KEY in the config .env before starting
#   --dir DIR           keep everything under DIR instead of the XDG directories below
#   --version TAG       release tag (default: latest)
#   --no-start          write files without starting
#
# Files follow the XDG Base Directory Specification:
#   config  ${XDG_CONFIG_HOME:-~/.config}/sps-mini-validator       .env, docker-compose.yml, run.sh
#   data    ${XDG_DATA_HOME:-~/.local/share}/sps-mini-validator    seed, checkpoints, snapshots
#   cache   ${XDG_CACHE_HOME:-~/.cache}/sps-mini-validator         block chunk cache, downloads
#   state   ${XDG_STATE_HOME:-~/.local/state}/sps-mini-validator   hashes.log, duties.log, service log
set -eu

REPO="finlaysonstudio/spsdao-mini-validator"
IMAGE="${SPS_MINI_IMAGE:-ghcr.io/finlaysonstudio/spsdao-mini-validator}"
MODE="docker"
SEED="latest"
ACCOUNTS=""
DIR=""
VERSION="latest"
START=1

while [ $# -gt 0 ]; do
  case "$1" in
    --docker) MODE="docker" ;;
    --native-install) MODE="native" ;;
    --genesis) SEED="genesis" ;;
    --accounts) ACCOUNTS="$2"; shift ;;
    --dir) DIR="$2"; shift ;;
    --version) VERSION="$2"; shift ;;
    --no-start) START=0 ;;
    -h|--help) sed -n '2,22p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

if [ -n "$DIR" ]; then
  CONFIG_DIR="$DIR"
  DATA_DIR="$DIR/data"
  CACHE_DIR="$DIR/cache"
  STATE_DIR="$DIR/state"
else
  CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/sps-mini-validator"
  DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/sps-mini-validator"
  CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/sps-mini-validator"
  STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/sps-mini-validator"
fi

need curl
if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/${REPO}/releases/latest/download"
  TAG="latest"
else
  BASE="https://github.com/${REPO}/releases/download/${VERSION}"
  TAG="${VERSION}"
fi
# Mirror of the release assets (testing, air-gapped installs).
[ -n "${SPS_MINI_RELEASE_BASE:-}" ] && BASE="$SPS_MINI_RELEASE_BASE"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

fetch() { # fetch <asset> <dest>
  curl -fL --retry 3 --progress-bar -o "$2.part" "${BASE}/$1" || die "download failed: ${BASE}/$1"
  mv "$2.part" "$2"
}

mkdir -p "$CONFIG_DIR" "$DATA_DIR" "$CACHE_DIR" "$STATE_DIR"
cd "$CONFIG_DIR"

# ---------------------------------------------------------------- seed
if [ "$SEED" = "genesis" ]; then SEED_ASSET="seed-genesis.ndjson.gz"; else SEED_ASSET="seed-latest.ndjson.gz"; fi
say "Downloading ${SEED_ASSET} (${VERSION})"
fetch SHA256SUMS "$DATA_DIR/SHA256SUMS"
fetch "$SEED_ASSET" "$DATA_DIR/$SEED_ASSET"
EXPECTED=$(grep " ${SEED_ASSET}\$" "$DATA_DIR/SHA256SUMS" | cut -d' ' -f1)
[ -n "$EXPECTED" ] || die "${SEED_ASSET} is not listed in SHA256SUMS"
[ "$(sha256 "$DATA_DIR/$SEED_ASSET")" = "$EXPECTED" ] || die "checksum mismatch for ${SEED_ASSET}"
say "Checksum ok"

# ---------------------------------------------------------------- config
if [ ! -f .env ]; then
  cat > .env <<EOF
# SPS Mini Validator configuration (see the README "Environment" table).
SEED_FILE=${DATA_DIR}/${SEED_ASSET}
CHECKPOINT_DIR=${DATA_DIR}/checkpoints
CHECKPOINT_EVERY=1000
CHUNK_CACHE_DIR=${CACHE_DIR}/chunks
HASH_LOG=${STATE_DIR}/hashes.log
SNAPSHOT_DIR=${DATA_DIR}/snapshots
VALIDATOR_ACCOUNTS=${ACCOUNTS}
# Posting key WIF(s), comma-separated, for VALIDATOR_ACCOUNTS (required when it is set).
VALIDATOR_KEY=
DUTY_LOG=${STATE_DIR}/duties.log
EOF
  chmod 600 .env
  say "Wrote ${CONFIG_DIR}/.env"
else
  say "Keeping existing ${CONFIG_DIR}/.env"
fi
if grep -q '^VALIDATOR_ACCOUNTS=.' .env && ! grep -q '^VALIDATOR_KEY=.' .env; then
  say "Add VALIDATOR_KEY to ${CONFIG_DIR}/.env, then start the validator"
  START=0
fi

# ---------------------------------------------------------------- docker
if [ "$MODE" = "docker" ]; then
  need docker
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"
  # Paths inside the container are /data, /cache and /state; the .env above is for a native install, so map it here.
  cat > docker-compose.yml <<EOF
services:
  validator:
    image: ${IMAGE}:${TAG}
    container_name: sps-mini-validator
    restart: unless-stopped
    env_file: .env
    environment:
      SEED_FILE: /data/${SEED_ASSET}
      CHECKPOINT_DIR: /data/checkpoints
      CHUNK_CACHE_DIR: /cache/chunks
      HASH_LOG: /state/hashes.log
      SNAPSHOT_DIR: /data/snapshots
      DUTY_LOG: /state/duties.log
    volumes:
      - ${DATA_DIR}:/data
      - ${CACHE_DIR}:/cache
      - ${STATE_DIR}:/state
    mem_limit: 4g
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
EOF
  # The image runs as uid 1000 (node).
  chmod -R a+rwX "$DATA_DIR" "$CACHE_DIR" "$STATE_DIR" 2>/dev/null || true
  say "Wrote ${CONFIG_DIR}/docker-compose.yml"
  if [ "$START" = 1 ]; then
    docker compose pull --ignore-pull-failures
    docker compose up -d
    say "Started. Logs: cd ${CONFIG_DIR} && docker compose logs -f"
  fi
  exit 0
fi

# ---------------------------------------------------------------- native install
need node
need npm
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 24 ] || die "Node 24 or newer is required (found $(node -v))"
say "Installing sps-mini-validator (${VERSION}) with npm"
fetch "spsdao-mini-validator.tgz" "$CACHE_DIR/spsdao-mini-validator.tgz"
npm install --global "$CACHE_DIR/spsdao-mini-validator.tgz"
BIN=$(command -v sps-mini-validator) || die "sps-mini-validator not on PATH after npm install"
sps-mini-validator version

cat > run.sh <<EOF
#!/bin/sh
# Loads ${CONFIG_DIR}/.env and runs the validator (used by the service unit).
set -a
. "${CONFIG_DIR}/.env"
set +a
exec "${BIN}" run
EOF
chmod 755 run.sh

case "$(uname -s)" in
  Linux)
    need systemctl
    mkdir -p "${HOME}/.config/systemd/user"
    cat > "${HOME}/.config/systemd/user/sps-mini-validator.service" <<EOF
[Unit]
Description=SPS Mini Validator
After=network-online.target

[Service]
ExecStart=${CONFIG_DIR}/run.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
    if [ "$START" = 1 ]; then
      systemctl --user daemon-reload
      systemctl --user enable --now sps-mini-validator
      say "Started. Logs: journalctl --user -u sps-mini-validator -f (enable lingering to run without a login: loginctl enable-linger)"
    fi
    ;;
  Darwin)
    PLIST="${HOME}/Library/LaunchAgents/net.spsdao.mini-validator.plist"
    mkdir -p "${HOME}/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>net.spsdao.mini-validator</string>
  <key>ProgramArguments</key><array><string>${CONFIG_DIR}/run.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$(command -v node)"):/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${STATE_DIR}/sps-mini-validator.log</string>
  <key>StandardErrorPath</key><string>${STATE_DIR}/sps-mini-validator.log</string>
</dict>
</plist>
EOF
    if [ "$START" = 1 ]; then
      launchctl unload "$PLIST" 2>/dev/null || true
      launchctl load "$PLIST"
      say "Started. Logs: tail -f ${STATE_DIR}/sps-mini-validator.log"
    fi
    ;;
  *)
    say "No service manager support for $(uname -s); run ${CONFIG_DIR}/run.sh"
    ;;
esac
