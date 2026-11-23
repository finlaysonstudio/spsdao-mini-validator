#!/bin/sh
# SPS Mini Validator installer.
#
#   curl -fsSL https://raw.githubusercontent.com/finlaysonstudio/spsdao-mini-validator/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --native-install --accounts alice,bob
#
# Options:
#   --docker            run in Docker (default; image ghcr.io/finlaysonstudio/spsdao-mini-validator)
#   --native-install    install the sps-mini CLI with npm (Node 24+) and a systemd/launchd service
#   --genesis           start from the genesis seed (block 93703455) and replay to head (hours, ~6 GB
#                       chunk cache) instead of the latest published seed
#   --accounts a,b      validator accounts for shadow-mode duties (no keys are read)
#   --dir DIR           install directory (default ~/.sps-mini)
#   --version TAG       release tag (default: latest)
#   --no-start          write files without starting
set -eu

REPO="finlaysonstudio/spsdao-mini-validator"
IMAGE="${SPS_MINI_IMAGE:-ghcr.io/finlaysonstudio/spsdao-mini-validator}"
MODE="docker"
SEED="latest"
ACCOUNTS=""
DIR="${HOME}/.sps-mini"
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
    -h|--help) sed -n '2,17p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

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

mkdir -p "$DIR/data"
cd "$DIR"

# ---------------------------------------------------------------- seed
if [ "$SEED" = "genesis" ]; then SEED_ASSET="seed-genesis.ndjson.gz"; else SEED_ASSET="seed-latest.ndjson.gz"; fi
say "Downloading ${SEED_ASSET} (${VERSION})"
fetch SHA256SUMS data/SHA256SUMS
fetch "$SEED_ASSET" "data/$SEED_ASSET"
EXPECTED=$(grep " ${SEED_ASSET}\$" data/SHA256SUMS | cut -d' ' -f1)
[ -n "$EXPECTED" ] || die "${SEED_ASSET} is not listed in SHA256SUMS"
[ "$(sha256 "data/$SEED_ASSET")" = "$EXPECTED" ] || die "checksum mismatch for ${SEED_ASSET}"
say "Checksum ok"

# ---------------------------------------------------------------- config
if [ ! -f .env ]; then
  cat > .env <<EOF
# SPS Mini Validator configuration (see the README "Environment" table).
SEED_FILE=${DIR}/data/${SEED_ASSET}
CHECKPOINT_DIR=${DIR}/data/checkpoints
CHECKPOINT_EVERY=1000
CHUNK_CACHE_DIR=${DIR}/data/chunks
HASH_LOG=${DIR}/data/hashes.log
SNAPSHOT_DIR=${DIR}/data/snapshots
VALIDATOR_ACCOUNTS=${ACCOUNTS}
VALIDATOR_MODE=shadow
DUTY_LOG=${DIR}/data/duties.log
EOF
  chmod 600 .env
  say "Wrote ${DIR}/.env"
else
  say "Keeping existing ${DIR}/.env"
fi

# ---------------------------------------------------------------- docker
if [ "$MODE" = "docker" ]; then
  need docker
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"
  # Paths inside the container are /data; the .env above is for a native install, so map it here.
  cat > docker-compose.yml <<EOF
services:
  validator:
    image: ${IMAGE}:${TAG}
    container_name: sps-mini
    restart: unless-stopped
    env_file: .env
    environment:
      SEED_FILE: /data/${SEED_ASSET}
      CHECKPOINT_DIR: /data/checkpoints
      CHUNK_CACHE_DIR: /data/chunks
      HASH_LOG: /data/hashes.log
      SNAPSHOT_DIR: /data/snapshots
      DUTY_LOG: /data/duties.log
    volumes:
      - ./data:/data
    mem_limit: 4g
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
EOF
  # The image runs as uid 1000 (node).
  chmod -R a+rwX data 2>/dev/null || true
  say "Wrote ${DIR}/docker-compose.yml"
  if [ "$START" = 1 ]; then
    docker compose pull --ignore-pull-failures
    docker compose up -d
    say "Started. Logs: cd ${DIR} && docker compose logs -f"
  fi
  exit 0
fi

# ---------------------------------------------------------------- native install
need node
need npm
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 24 ] || die "Node 24 or newer is required (found $(node -v))"
say "Installing sps-mini (${VERSION}) with npm"
fetch "spsdao-mini-validator.tgz" "data/spsdao-mini-validator.tgz"
npm install --global "${DIR}/data/spsdao-mini-validator.tgz"
BIN=$(command -v sps-mini) || die "sps-mini not on PATH after npm install"
sps-mini version

cat > run.sh <<EOF
#!/bin/sh
# Loads ${DIR}/.env and runs the validator (used by the service unit).
set -a
. "${DIR}/.env"
set +a
exec "${BIN}" run
EOF
chmod 755 run.sh

case "$(uname -s)" in
  Linux)
    need systemctl
    mkdir -p "${HOME}/.config/systemd/user"
    cat > "${HOME}/.config/systemd/user/sps-mini.service" <<EOF
[Unit]
Description=SPS Mini Validator
After=network-online.target

[Service]
ExecStart=${DIR}/run.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
    if [ "$START" = 1 ]; then
      systemctl --user daemon-reload
      systemctl --user enable --now sps-mini
      say "Started. Logs: journalctl --user -u sps-mini -f (enable lingering to run without a login: loginctl enable-linger)"
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
  <key>ProgramArguments</key><array><string>${DIR}/run.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$(command -v node)"):/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${DIR}/data/sps-mini.log</string>
  <key>StandardErrorPath</key><string>${DIR}/data/sps-mini.log</string>
</dict>
</plist>
EOF
    if [ "$START" = 1 ]; then
      launchctl unload "$PLIST" 2>/dev/null || true
      launchctl load "$PLIST"
      say "Started. Logs: tail -f ${DIR}/data/sps-mini.log"
    fi
    ;;
  *)
    say "No service manager support for $(uname -s); run ${DIR}/run.sh"
    ;;
esac
