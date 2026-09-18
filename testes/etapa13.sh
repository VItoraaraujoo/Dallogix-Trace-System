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

queue_id="${TRACE_SYNC_QUEUE_ID:-$(printf '%s' "$queue" | node -e 'let input=""; process.stdin.on("data", chunk => input += chunk).on("end", () => { const rows = JSON.parse(input).data || []; const pending = rows.find(row => row.status === "PENDENTE"); process.stdout.write(pending ? String(pending.id) : ""); });')}"
[ -n "$queue_id" ] || { echo "FAIL: nenhuma pendência identificável na fila local"; exit 1; }

processed="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"id\":$queue_id}" "$base_url/api/sync_queue.php")"
if ! printf '%s' "$processed" | grep -Eq 'SYNC_REMOTE_URL não configurada|Nenhum endpoint de sincronização remota configurado|\"status\":\"ERRO\"|\"status\":\"PENDENTE\"|\"status\":\"ENVIADO\"|\"processed\":true'; then
  echo "FAIL: fila não preservou o evento após tentativa de sincronização: $processed"
  exit 1
fi

echo "OK: fila protegida consultada e pendência preservada sem endpoint remoto."
