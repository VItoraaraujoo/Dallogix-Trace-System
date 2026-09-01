#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
backup="${1:-}"
if [[ -z "$backup" || ! -f "$backup" ]]; then
  echo "Uso: $0 /caminho/backup.sql" >&2
  exit 2
fi

if [[ -f "$backup.sha256" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$backup")" && sha256sum -c "$(basename "$backup").sha256")
  else
    (cd "$(dirname "$backup")" && shasum -a 256 -c "$(basename "$backup").sha256")
  fi
fi

grep -q '^-- MySQL dump' "$backup" || {
  echo "Backup inválido: cabeçalho mysqldump não encontrado." >&2
  exit 3
}
grep -q 'CREATE TABLE' "$backup" || {
  echo "Backup inválido: nenhuma tabela encontrada." >&2
  exit 4
}
printf 'Backup íntegro e com estrutura SQL válida: %s\n' "$backup"
