#!/bin/sh
# Spud, the SPS mini validator: installer.
#
#   curl -fsSL https://raw.githubusercontent.com/spudsps/spudsps-validator/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --native-install --accounts alice,bob
#
# Options:
#   --docker            run in Docker (default; image ghcr.io/spudsps/spudsps-validator)
#   --native-install    install the spudsps CLI with npm (Node 24+) and a systemd/launchd service
#   --genesis           start from the genesis seed (block 93703455) and replay to head (hours, ~6 GB
#                       chunk cache) instead of the latest published seed
#   --accounts a,b      validator accounts to perform duties for; add their posting key(s) as
#                       VALIDATOR_KEY in <dir>/.env before starting
#   --dir DIR           install directory (default ~/.spudsps)
#   --version TAG       release tag (default: latest)
#   --no-start          write files without starting
#   --auto-update       schedule the daily update (off by default; `spud auto-update on` turns it on later)
#   --no-auto-update    turn the daily update off (on --update, overrides AUTO_UPDATE in .env)
#   --update            update an existing install in <dir> (used by `spud update`): keeps .env and
#                       data, reuses the recorded mode, skips the seed, rewrites the service and spud
#
# Layout under <dir>:
#   .env, install.conf, docker-compose.yml, run.sh, bin/spud (also linked from ~/.local/bin/spud)
#   data/    seed, checkpoints, snapshots
#   cache/   block chunk cache, downloads
#   state/   hashes.log, duties.log, service log
set -eu

REPO="spudsps/spudsps-validator"
: "${SPUDSPS_IMAGE:=${SPS_MINI_IMAGE:-}}" "${SPUDSPS_RELEASE_BASE:=${SPS_MINI_RELEASE_BASE:-}}"
IMAGE="${SPUDSPS_IMAGE:-ghcr.io/spudsps/spudsps-validator}"
MODE="docker"
SEED="latest"
ACCOUNTS=""
DIR="${HOME}/.spudsps"
VERSION="latest"
START=1
UPDATE=0
AUTO_UPDATE="" # empty: new installs default to off, updates follow AUTO_UPDATE in .env

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
    --auto-update) AUTO_UPDATE=1 ;;
    --no-auto-update) AUTO_UPDATE=0 ;;
    -h|--help) sed -n '2,26p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

# ---------------------------------------------------------------- legacy (0.3.x and earlier)
# Releases before 0.4.0 installed to ~/.sps-mini-validator as finlaysonstudio/spsdao-mini-validator
# (service sps-mini-validator, launchd label net.spsdao.mini-validator). Move such an install to
# ~/.spudsps, keep a symlink at the old path (an older spud running this update execs through it),
# and remove the old service and auto-update scheduler. .env and data are kept.
LEGACY_DIR="${HOME}/.sps-mini-validator"
LEGACY_REPO="finlaysonstudio/spsdao-mini-validator"
LEGACY_IMAGE="ghcr.io/finlaysonstudio/spsdao-mini-validator"
DEFAULT_DIR="${HOME}/.spudsps"
legacy_get() { sed -n "s/^$1='\(.*\)'\$/\1/p" "$LEGACY_DIR/install.conf"; }
migrate_legacy() {
  [ ! -e "$DEFAULT_DIR" ] || die "both $LEGACY_DIR and $DEFAULT_DIR exist; move one aside and run again"
  say "Moving ${LEGACY_DIR} to ${DEFAULT_DIR}"
  l_service=$(legacy_get SERVICE)
  l_unit=$(legacy_get UNIT)
  l_label=$(legacy_get LABEL)
  l_plist=$(legacy_get PLIST)
  case "$l_service" in
    docker) (cd "$LEGACY_DIR" && docker compose down) || true ;;
    systemd)
      systemctl --user disable --now "${l_unit:-sps-mini-validator}" 2>/dev/null || true
      rm -f "${HOME}/.config/systemd/user/${l_unit:-sps-mini-validator}.service" ;;
    launchd)
      launchctl bootout "gui/$(id -u)/${l_label:-net.spsdao.mini-validator}" 2>/dev/null || true
      [ -n "$l_plist" ] && rm -f "$l_plist" ;;
  esac
  # Old auto-update scheduler. A scheduled run of the old spud may be running this script, so a
  # loaded launchd job is left loaded (it runs the new spud through the symlink until next login).
  if [ -z "${SPUD_AUTO:-}" ]; then
    launchctl bootout "gui/$(id -u)/net.spsdao.mini-validator.update" 2>/dev/null || true
  fi
  rm -f "${HOME}/Library/LaunchAgents/net.spsdao.mini-validator.update.plist"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable sps-mini-validator-update.timer >/dev/null 2>&1 || true
    rm -f "${HOME}/.config/systemd/user/sps-mini-validator-update.service" \
      "${HOME}/.config/systemd/user/sps-mini-validator-update.timer"
    systemctl --user daemon-reload 2>/dev/null || true
  fi
  if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -qF "# sps-mini-validator auto-update $LEGACY_DIR"; then
    crontab -l 2>/dev/null | grep -vF "# sps-mini-validator auto-update $LEGACY_DIR" | crontab -
  fi
  if [ "$(legacy_get MODE)" = native ] && command -v npm >/dev/null 2>&1; then
    npm uninstall --global @spsdao/mini-validator >/dev/null 2>&1 || true
  fi
  mv "$LEGACY_DIR" "$DEFAULT_DIR"
  ln -s "$DEFAULT_DIR" "$LEGACY_DIR"
  # Absolute paths in .env and the recorded repo/image follow the move.
  for f in "$DEFAULT_DIR/.env" "$DEFAULT_DIR/install.conf"; do
    [ -f "$f" ] || continue
    sed -e "s#${LEGACY_DIR}/#${DEFAULT_DIR}/#g" -e "s#${LEGACY_DIR}'#${DEFAULT_DIR}'#g" \
      -e "s#${LEGACY_IMAGE}#ghcr.io/${REPO}#g" -e "s#${LEGACY_REPO}#${REPO}#g" "$f" > "$f.new"
    chmod 600 "$f.new"
    mv "$f.new" "$f"
  done
  rm -f "$DEFAULT_DIR/run.sh" "$DEFAULT_DIR/cache/spsdao-mini-validator.tgz"
  [ -L "$HOME/.local/bin/spud" ] && [ "$(readlink "$HOME/.local/bin/spud")" = "$LEGACY_DIR/bin/spud" ] && rm -f "$HOME/.local/bin/spud"
  DIR="$DEFAULT_DIR"
}
if [ "$DIR" = "$LEGACY_DIR" ] || [ "$DIR" = "$DEFAULT_DIR" ]; then
  if [ -d "$LEGACY_DIR" ] && [ ! -L "$LEGACY_DIR" ] && [ -f "$LEGACY_DIR/install.conf" ]; then
    migrate_legacy
  elif [ -L "$LEGACY_DIR" ]; then
    DIR="$DEFAULT_DIR"
  fi
fi

CONFIG_DIR="$DIR"
DATA_DIR="$DIR/data"
CACHE_DIR="$DIR/cache"
STATE_DIR="$DIR/state"

conf_get() { sed -n "s/^$1='\(.*\)'\$/\1/p" "$DIR/install.conf"; }

need curl
if [ "$UPDATE" = 1 ]; then
  [ -f "$DIR/install.conf" ] || die "no install in $DIR to update (install.conf is missing)"
  # Reuse the recorded mode, seed, mirror and image.
  MODE=$(conf_get MODE)
  SEED_ASSET=$(conf_get SEED_ASSET)
  RECORDED_BASE=$(conf_get RELEASE_BASE)
  [ -z "${SPUDSPS_RELEASE_BASE:-}" ] && [ -n "$RECORDED_BASE" ] && SPUDSPS_RELEASE_BASE=$RECORDED_BASE
  RECORDED_IMAGE=$(conf_get IMAGE)
  [ -z "${SPUDSPS_IMAGE:-}" ] && [ -n "$RECORDED_IMAGE" ] && IMAGE=$RECORDED_IMAGE
  [ -n "$MODE" ] || die "install.conf does not record the install mode"
fi
# Mirror of the release assets (testing, air-gapped installs).
RELEASE_BASE="${SPUDSPS_RELEASE_BASE:-}"
if [ "$VERSION" != "latest" ]; then
  TAG="$VERSION"
elif [ -z "$RELEASE_BASE" ]; then
  # Pin "latest" to its tag so every asset and the image come from the same release.
  TAG=$(curl -fsSIL -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest" 2>/dev/null | sed -n 's#.*/releases/tag/##p')
  [ -n "$TAG" ] || TAG="latest"
else
  # A mirror names its release in RELEASE.
  TAG=$(curl -fsSL "${RELEASE_BASE}/RELEASE" 2>/dev/null | head -n 1 | tr -d '[:space:]')
  [ -n "$TAG" ] || TAG="latest"
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
    echo "UNIT=$(q "spudsps")"
    echo "LABEL=$(q "com.spudsps.validator")"
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
  # Daily auto-update: a flag sets it, otherwise it follows AUTO_UPDATE in .env (spud owns the scheduler).
  case "$AUTO_UPDATE" in
    1) "$CONFIG_DIR/bin/spud" auto-update on || true ;;
    0) "$CONFIG_DIR/bin/spud" auto-update off || true ;;
    *) "$CONFIG_DIR/bin/spud" auto-update sync || true ;;
  esac
  say "Manage it with spud: spud status, spud logs -f, spud add <account>, spud update"
}

# ---------------------------------------------------------------- config
if [ ! -f .env ]; then
  cat > .env <<EOF
# Spud configuration (see the README "Environment" table).
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
# Daily update to the latest release, checked and rolled back on failure (spud auto-update on|off).
AUTO_UPDATE=${AUTO_UPDATE:-0}
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
name: spudsps
services:
  validator:
    image: ${IMAGE}:${TAG}
    container_name: spudsps
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
say "Installing spudsps (${TAG}) with npm"
fetch "spudsps.tgz" "$CACHE_DIR/spudsps.tgz"
verify "spudsps.tgz" "$CACHE_DIR/spudsps.tgz"
npm install --global "$CACHE_DIR/spudsps.tgz"
BIN=$(command -v spudsps) || die "spudsps not on PATH after npm install"
spudsps version

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
    cat > "${HOME}/.config/systemd/user/spudsps.service" <<EOF
[Unit]
Description=Spud, the SPS mini validator
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
      systemctl --user enable spudsps
      systemctl --user restart spudsps
      say "Started (to keep it running without a login: loginctl enable-linger)"
    fi
    ;;
  Darwin)
    PLIST="${HOME}/Library/LaunchAgents/com.spudsps.validator.plist"
    mkdir -p "${HOME}/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.spudsps.validator</string>
  <key>ProgramArguments</key><array><string>${CONFIG_DIR}/run.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$(command -v node)"):/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${STATE_DIR}/spudsps.log</string>
  <key>StandardErrorPath</key><string>${STATE_DIR}/spudsps.log</string>
</dict>
</plist>
EOF
    install_spud native launchd
    if [ "$START" = 1 ]; then
      launchctl bootout "gui/$(id -u)/com.spudsps.validator" 2>/dev/null || true
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
