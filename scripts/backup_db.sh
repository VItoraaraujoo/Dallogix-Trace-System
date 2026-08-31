#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="${1:-$root_dir/armazenamento/backups}"
mkdir -p "$output_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_file="$output_dir/trace_local_${timestamp}.sql"

docker compose exec -T mysql mysqldump \
  --single-transaction \
  --routines \
  --events \
  --triggers \
  --no-tablespaces \
  -utrace -p"${MYSQL_PASSWORD:-change-me-local}" \
  "${MYSQL_DATABASE:-trace_local}" > "$output_file"

test -s "$output_file"
printf 'Backup criado: %s\n' "$output_file"
