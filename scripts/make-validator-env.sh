#!/bin/sh
# Write var/validator.env with the validator posting key, read from a running node's
# container environment (default: the upstream validator). Nothing is printed.
#
#   scripts/make-validator-env.sh [container] [out]
set -eu
cd "$(dirname "$0")/.."
container=${1:-splinterlands-validator-validator-1}
out=${2:-var/validator.env}
mkdir -p "$(dirname "$out")"
umask 077
key=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^VALIDATOR_KEY=//p')
[ -n "$key" ] || { echo "no VALIDATOR_KEY in $container" >&2; exit 1; }
echo "VALIDATOR_KEY=$key" > "$out"
chmod 600 "$out"
echo "wrote $out (key from $container)"
