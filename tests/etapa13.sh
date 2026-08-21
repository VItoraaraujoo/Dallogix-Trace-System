#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa13-cookie.txt"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi

queue="$(curl -sS -b "$cookie_file" "$base_url/api/sync_queue.php")"
if ! printf '%s' "$queue" | grep -q '"status":"PENDENTE"'; then
  echo "FAIL: fila local não retornou pendências"
  exit 1
fi

processed="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"id":1}' "$base_url/api/sync_queue.php")"
if ! printf '%s' "$processed" | grep -q 'SYNC_REMOTE_URL não configurada'; then
  echo "FAIL: modo offline não preservou a pendência: $processed"
  exit 1
fi

echo "OK: fila protegida consultada e pendência preservada sem endpoint remoto."
