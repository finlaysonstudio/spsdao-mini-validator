#!/bin/sh
# Write LOCAL/checker.env with the Postgres credentials of the running upstream
# validator (read from its container environment; nothing is printed).
set -eu
cd "$(dirname "$0")/.."
out=${1:-LOCAL/checker.env}
mkdir -p "$(dirname "$out")"
docker inspect splinterlands-validator-pg-1 --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^POSTGRES_(USER|PASSWORD)=' \
  | sed 's/^POSTGRES_USER=/PGUSER=/; s/^POSTGRES_PASSWORD=/PGPASSWORD=/' > "$out"
chmod 600 "$out"
echo "wrote $out ($(wc -l < "$out" | tr -d ' ') variables)"
