#!/bin/sh
# Write LOCAL/validator.env with the validator posting key, read from a running node's
# container environment (default: the upstream validator). Nothing is printed.
# The observer stays in shadow mode until VALIDATOR_MODE=live is added to that file.
#
#   scripts/make-validator-env.sh [container] [out]
set -eu
cd "$(dirname "$0")/.."
container=${1:-splinterlands-validator-validator-1}
out=${2:-LOCAL/validator.env}
mkdir -p "$(dirname "$out")"
umask 077
key=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^VALIDATOR_KEY=//p')
[ -n "$key" ] || { echo "no VALIDATOR_KEY in $container" >&2; exit 1; }
mode=$(sed -n 's/^VALIDATOR_MODE=//p' "$out" 2>/dev/null || true)
{
  echo "VALIDATOR_KEY=$key"
  [ -n "$mode" ] && echo "VALIDATOR_MODE=$mode"
} > "$out"
chmod 600 "$out"
echo "wrote $out (key from $container, mode ${mode:-shadow})"
