#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Uso: $0 /caminho/backup.sql" >&2
  exit 2
fi
if [[ "${APP_ENV:-local}" == "production" && "${TRACE_ALLOW_RESTORE:-0}" != "1" ]]; then
  echo "Restauração bloqueada em produção. Defina TRACE_ALLOW_RESTORE=1 conscientemente." >&2
  exit 3
fi

docker compose exec -T mysql mysql \
  -utrace -p"${MYSQL_PASSWORD:-change-me-local}" \
  "${MYSQL_DATABASE:-trace_local}" < "$1"
printf 'Backup restaurado: %s\n' "$1"
