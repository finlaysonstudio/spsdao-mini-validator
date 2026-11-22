#!/bin/sh
# Upload a seed to a GitHub release as seed-latest (default) or seed-genesis, after verifying it
# against the reference archive, and rewrite the release's SHA256SUMS.
#
#   scripts/publish-seed.sh <seed.ndjson.gz> [--genesis] [--tag vX.Y.Z]
#
# Requires gh (authenticated) and a built CLI (npm run build).
set -eu
cd "$(dirname "$0")/.."

SEED=""; NAME="seed-latest"; TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --genesis) NAME="seed-genesis" ;;
    --tag) TAG="$2"; shift ;;
    *) SEED="$1" ;;
  esac
  shift
done
[ -n "$SEED" ] || { echo "usage: $0 <seed.ndjson.gz> [--genesis] [--tag vX.Y.Z]" >&2; exit 2; }
[ -n "$TAG" ] || TAG=$(gh release list --limit 1 --exclude-drafts --exclude-pre-releases --json tagName --jq '.[0].tagName')

node packages/validator/dist/cli.mjs verify "$SEED"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp "$SEED" "$WORK/${NAME}.ndjson.gz"
MANIFEST="${SEED%.ndjson.gz}.manifest.json"
[ -f "$MANIFEST" ] && cp "$MANIFEST" "$WORK/${NAME}.manifest.json"

gh release download "$TAG" --pattern SHA256SUMS --dir "$WORK" 2>/dev/null || : > "$WORK/SHA256SUMS"
grep -v -E " ${NAME}\.(ndjson\.gz|manifest\.json)\$" "$WORK/SHA256SUMS" > "$WORK/SHA256SUMS.new" || true
( cd "$WORK" && for f in "${NAME}".*; do
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f"; else shasum -a 256 "$f"; fi
  done ) >> "$WORK/SHA256SUMS.new"
mv "$WORK/SHA256SUMS.new" "$WORK/SHA256SUMS"

gh release upload "$TAG" "$WORK/${NAME}".* "$WORK/SHA256SUMS" --clobber
echo "published ${NAME} to ${TAG}"
