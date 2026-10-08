#!/usr/bin/env bash
set -u
source "$(cd "$(dirname "$0")" && pwd)/lib/csrf.sh"

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
trace_exigir_compose_producao_teste
base_url="$TRACE_BASE_URL"
cookie_file="$trace_test_tmp_dir/dallogix-trace-etapa7-cookie.txt"
source "$(cd "$(dirname "$0")" && pwd)/lib/ensure_loading.sh"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi
csrf_header="$(trace_csrf_header "$login")" || exit 1

loading_id="${TRACE_LOADING_ID:-$(ensure_loading_carregando)}"
[ -n "$loading_id" ] || { echo "FAIL: nenhum carregamento CARREGANDO disponível"; exit 1; }

reading="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":$loading_id,\"barcode\":\"7898250782592\"}" "$base_url/api/leituras.php")"
if ! printf '%s' "$reading" | grep -q '"result":"VALIDO"'; then
  echo "FAIL: leitura operacional falhou: $reading"
  exit 1
fi

audit_count="$(trace_test_mysql_query root "SELECT COUNT(*) FROM logs_auditoria WHERE action='LEITURA_REGISTRADA';" 2>/dev/null)"
sync_count="$(trace_test_mysql_query root "SELECT COUNT(*) FROM fila_sincronizacao WHERE aggregate_type='leitura';" 2>/dev/null)"

if [[ -z "$audit_count" || "$audit_count" -lt 1 ]]; then
  echo "FAIL: auditoria não foi registrada"
  exit 1
fi
if [[ -z "$sync_count" || "$sync_count" -lt 1 ]]; then
  echo "FAIL: fila de sincronização não foi registrada"
  exit 1
fi

echo "OK: auditoria e fila local registraram a leitura operacional."
