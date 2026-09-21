#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa19-cookie.txt"
source "$(cd "$(dirname "$0")" && pwd)/lib/ensure_loading.sh"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' \
  -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login do simulador falhou"
  exit 1
fi

TRACE_FORCE_NEW_LOADING=1 loading_id="$(ensure_loading_carregando)"
if [[ -z "$loading_id" ]]; then
  echo "FAIL: não foi possível preparar carregamento para o simulador"
  exit 1
fi
equipment_id="${TRACE_EQUIPMENT_ID:-$(curl -sS -b "$cookie_file" "$base_url/api/carregamentos.php" | sed -n 's/.*"id":'"$loading_id"',"state":"[^"]*","equipment_id":\([0-9][0-9]*\).*/\1/p' | head -n 1)}"
if [[ -z "$equipment_id" ]]; then
  echo "FAIL: não foi possível identificar equipamento do simulador"
  exit 1
fi

valid="$(TRACE_BASE_URL="$base_url" TRACE_LOADING_ID="$loading_id" TRACE_EQUIPMENT_ID="$equipment_id" \
  TRACE_DEVICE_TOKEN="${TRACE_DEVICE_TOKEN:-}" \
  bash scripts/simulate_clp.sh 7898250782592)"
if ! printf '%s' "$valid" | grep -q '"result":"VALIDO"'; then
  echo "FAIL: simulador não produziu leitura válida"
  exit 1
fi

failed="$(TRACE_BASE_URL="$base_url" TRACE_LOADING_ID="$loading_id" TRACE_EQUIPMENT_ID="$equipment_id" \
  TRACE_DEVICE_TOKEN="${TRACE_DEVICE_TOKEN:-}" \
  bash scripts/simulate_clp.sh SEM_LEITURA)"
if ! printf '%s' "$failed" | grep -q '"result":"SEM_LEITURA"'; then
  echo "FAIL: simulador não produziu falha de leitura"
  exit 1
fi

echo "OK: simulador validou leitura normal e incidente sem leitura."
