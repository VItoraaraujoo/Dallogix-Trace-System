#!/usr/bin/env bash
set -euo pipefail

failures=0
required=(MYSQL_PASSWORD MYSQL_ROOT_PASSWORD PLC_INTERNAL_TOKEN CAMERA_INTERNAL_TOKEN APP_URL)
for key in "${required[@]}"; do
  value="${!key:-}"
  if [[ -z "$value" || "$value" == change-me-* ]]; then
    echo "ERRO: $key precisa ser definido com valor próprio." >&2
    failures=$((failures + 1))
  fi
done

if [[ "${APP_ENV:-}" != "production" ]]; then
  echo "ERRO: APP_ENV deve ser production para esta verificação." >&2
  failures=$((failures + 1))
fi
if [[ "${SESSION_SECURE:-}" != "true" ]]; then
  echo "ERRO: SESSION_SECURE deve ser true em produção." >&2
  failures=$((failures + 1))
fi
if [[ "${APP_URL:-}" != https://* ]]; then
  echo "ERRO: APP_URL deve usar HTTPS em produção." >&2
  failures=$((failures + 1))
fi
if [[ -n "${SYNC_REMOTE_URL:-}" && -z "${SYNC_REMOTE_TOKEN:-}" ]]; then
  echo "ERRO: SYNC_REMOTE_TOKEN é obrigatório quando SYNC_REMOTE_URL está configurada." >&2
  failures=$((failures + 1))
fi

if [[ "$failures" -gt 0 ]]; then
  exit 1
fi
echo "OK: configuração mínima de produção validada sem exibir segredos."
