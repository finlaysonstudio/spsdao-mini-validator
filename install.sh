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
#                       VALIDATOR_KEY in <dir>/.env before starting
#   --dir DIR           install directory (default ~/.sps-mini-validator)
#   --version TAG       release tag (default: latest)
#   --no-start          write files without starting
#   --update            update an existing install in <dir> (used by `spud update`): keeps .env and
#                       data, reuses the recorded mode, skips the seed, rewrites the service and spud
#
# Layout under <dir>:
#   .env, install.conf, docker-compose.yml, run.sh, bin/spud (also linked from ~/.local/bin/spud)
#   data/    seed, checkpoints, snapshots
#   cache/   block chunk cache, downloads
#   state/   hashes.log, duties.log, service log
set -eu

REPO="finlaysonstudio/spsdao-mini-validator"
IMAGE="${SPS_MINI_IMAGE:-ghcr.io/finlaysonstudio/spsdao-mini-validator}"
MODE="docker"
SEED="latest"
ACCOUNTS=""
DIR="${HOME}/.sps-mini-validator"
VERSION="latest"
START=1
UPDATE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --docker) MODE="docker" ;;
    --native-install) MODE="native" ;;
    --genesis) SEED="genesis" ;;
    --accounts) ACCOUNTS="$2"; shift ;;
    --dir) DIR="$2"; shift ;;
    --version) VERSION="$2"; shift ;;
    --no-start) START=0 ;;
    --update) UPDATE=1 ;;
    -h|--help) sed -n '2,24p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

CONFIG_DIR="$DIR"
DATA_DIR="$DIR/data"
CACHE_DIR="$DIR/cache"
STATE_DIR="$DIR/state"

conf_get() { sed -n "s/^$1='\(.*\)'\$/\1/p" "$DIR/install.conf"; }

need curl
if [ "$UPDATE" = 1 ]; then
  [ -f "$DIR/install.conf" ] || die "no install in $DIR to update (install.conf is missing)"
  # Reuse the recorded mode, seed and mirror.
  MODE=$(conf_get MODE)
  SEED_ASSET=$(conf_get SEED_ASSET)
  RECORDED_BASE=$(conf_get RELEASE_BASE)
  [ -z "${SPS_MINI_RELEASE_BASE:-}" ] && [ -n "$RECORDED_BASE" ] && SPS_MINI_RELEASE_BASE=$RECORDED_BASE
  [ -n "$MODE" ] || die "install.conf does not record the install mode"
fi
# Mirror of the release assets (testing, air-gapped installs).
RELEASE_BASE="${SPS_MINI_RELEASE_BASE:-}"
if [ "$VERSION" != "latest" ]; then
  TAG="$VERSION"
elif [ -z "$RELEASE_BASE" ]; then
  # Pin "latest" to its tag so every asset and the image come from the same release.
  TAG=$(curl -fsSI -o /dev/null -w '%{redirect_url}' "https://github.com/${REPO}/releases/latest" 2>/dev/null | sed -n 's#.*/releases/tag/##p')
  [ -n "$TAG" ] || TAG="latest"
else
  TAG="latest"
fi
if [ -n "$RELEASE_BASE" ]; then BASE="$RELEASE_BASE"
elif [ "$TAG" = "latest" ]; then BASE="https://github.com/${REPO}/releases/latest/download"
else BASE="https://github.com/${REPO}/releases/download/${TAG}"; fi

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

verify() { # verify <asset> <file>: check a downloaded asset against SHA256SUMS
  EXPECTED=$(grep " $1\$" "$DATA_DIR/SHA256SUMS" | cut -d' ' -f1)
  [ -n "$EXPECTED" ] || die "$1 is not listed in SHA256SUMS"
  [ "$(sha256 "$2")" = "$EXPECTED" ] || die "checksum mismatch for $1"
}

fetch SHA256SUMS "$DATA_DIR/SHA256SUMS"

# ---------------------------------------------------------------- seed
if [ "$UPDATE" = 0 ]; then
  if [ "$SEED" = "genesis" ]; then SEED_ASSET="seed-genesis.ndjson.gz"; else SEED_ASSET="seed-latest.ndjson.gz"; fi
  say "Downloading ${SEED_ASSET} (${TAG})"
  fetch "$SEED_ASSET" "$DATA_DIR/$SEED_ASSET"
  verify "$SEED_ASSET" "$DATA_DIR/$SEED_ASSET"
  say "Checksum ok"
else
  say "Updating ${CONFIG_DIR} to ${TAG}"
fi

# ---------------------------------------------------------------- spud
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

install_spud() { # install_spud <mode> <service>: bin/spud, install.conf and ~/.local/bin/spud
  mkdir -p "$CONFIG_DIR/bin"
  fetch spud "$CONFIG_DIR/bin/spud.new"
  verify spud "$CONFIG_DIR/bin/spud.new"
  chmod 755 "$CONFIG_DIR/bin/spud.new"
  # A rename, so a running spud keeps reading the file it started with.
  mv "$CONFIG_DIR/bin/spud.new" "$CONFIG_DIR/bin/spud"
  {
    echo "# Written by install.sh; read by spud and by install.sh --update."
    echo "MODE=$(q "$1")"
    echo "SERVICE=$(q "$2")"
    echo "REPO=$(q "$REPO")"
    echo "TAG=$(q "$TAG")"
    echo "IMAGE=$(q "$IMAGE")"
    echo "SEED_ASSET=$(q "$SEED_ASSET")"
    echo "RELEASE_BASE=$(q "$RELEASE_BASE")"
    echo "BIN=$(q "${BIN:-}")"
    echo "UNIT=$(q "sps-mini-validator")"
    echo "LABEL=$(q "net.spsdao.mini-validator")"
    echo "PLIST=$(q "${PLIST:-}")"
  } > "$CONFIG_DIR/install.conf.new"
  mv "$CONFIG_DIR/install.conf.new" "$CONFIG_DIR/install.conf"
  mkdir -p "$HOME/.local/bin"
  ln -sf "$CONFIG_DIR/bin/spud" "$HOME/.local/bin/spud"
  # v0.2.0 installed this command as smv.
  if [ -L "$HOME/.local/bin/smv" ] && [ "$(readlink "$HOME/.local/bin/smv")" = "$CONFIG_DIR/bin/smv" ]; then
    rm -f "$HOME/.local/bin/smv"
  fi
  rm -f "$CONFIG_DIR/bin/smv"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) say "Add ~/.local/bin to PATH to run spud (or run ${CONFIG_DIR}/bin/spud)" ;;
  esac
}

done_message() {
  say "Manage it with spud: spud status, spud logs -f, spud add-account <name>, spud update"
}

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
  install_spud docker docker
  if [ "$START" = 1 ]; then
    docker compose pull --ignore-pull-failures
    docker compose up -d
    say "Started"
  fi
  done_message
  exit 0
fi

# ---------------------------------------------------------------- native install
need node
need npm
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 24 ] || die "Node 24 or newer is required (found $(node -v))"
say "Installing sps-mini-validator (${TAG}) with npm"
fetch "spsdao-mini-validator.tgz" "$CACHE_DIR/spsdao-mini-validator.tgz"
verify "spsdao-mini-validator.tgz" "$CACHE_DIR/spsdao-mini-validator.tgz"
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
    install_spud native systemd
    systemctl --user daemon-reload
    if [ "$START" = 1 ]; then
      systemctl --user enable sps-mini-validator
      systemctl --user restart sps-mini-validator
      say "Started (to keep it running without a login: loginctl enable-linger)"
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
    install_spud native launchd
    if [ "$START" = 1 ]; then
      launchctl bootout "gui/$(id -u)/net.spsdao.mini-validator" 2>/dev/null || true
      launchctl bootstrap "gui/$(id -u)" "$PLIST"
      say "Started"
    fi
    ;;
  *)
    install_spud native none
    say "No service manager support for $(uname -s); run ${CONFIG_DIR}/run.sh"
    ;;
esac
done_message
