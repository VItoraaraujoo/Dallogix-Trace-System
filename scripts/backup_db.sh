#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="${1:-$root_dir/armazenamento/backups}"
mkdir -p "$output_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_file="$output_dir/trace_local_${timestamp}.sql"

# As credenciais pertencem ao contêiner MySQL. Executar a expansão lá evita
# depender de variáveis existentes no host do servidor e não expõe a senha.
docker compose exec -T mysql sh -lc 'mysqldump --single-transaction --routines --events --triggers --no-tablespaces -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' > "$output_file"

test -s "$output_file"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$output_file" > "$output_file.sha256"
else
  shasum -a 256 "$output_file" > "$output_file.sha256"
fi

retention_days="${TRACE_BACKUP_RETENTION_DAYS:-30}"
if [[ "$retention_days" =~ ^[0-9]+$ ]]; then
  find "$output_dir" -maxdepth 1 -type f -name 'trace_local_*.sql' -mtime "+$retention_days" -delete
  find "$output_dir" -maxdepth 1 -type f -name 'trace_local_*.sql.sha256' -mtime "+$retention_days" -delete
fi
printf 'Backup criado: %s\n' "$output_file"
