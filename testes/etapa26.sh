#!/usr/bin/env bash
set -u

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
base_url="$TRACE_BASE_URL"
jar="$trace_test_tmp_dir/dx-etapa26-cookies.txt"
rm -f "$jar"
fail() { echo "FAIL: $1"; exit 1; }

login_code="$(curl -sS -o $trace_test_tmp_dir/dx-etapa26-login.json -w '%{http_code}' -c "$jar" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
[ "$login_code" = "200" ] || fail "login retornou HTTP $login_code"

status_code="$(curl -sS -o $trace_test_tmp_dir/dx-etapa26-sync.json -w '%{http_code}' -b "$jar" "$base_url/api/sync_status.php")"
[ "$status_code" = "200" ] || fail "sync_status retornou HTTP $status_code"
grep -q '"summary"' $trace_test_tmp_dir/dx-etapa26-sync.json || fail "status sem resumo"
grep -q '"remote_configured"' $trace_test_tmp_dir/dx-etapa26-sync.json || fail "status sem configuração remota"

unauth="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/api/sync_status.php")"
[ "$unauth" = "401" ] || fail "endpoint de sync sem autenticação retornou HTTP $unauth"

trace_test_fetch_page alerts.html alerts "$trace_test_tmp_dir/dx-etapa26-alerts.html" || fail "alerts.html não entrega a tela de alertas"
app_js="$(curl -sS "$base_url/js/aplicacao.js")"
grep -q 'loadSyncStatus' <<< "$app_js" || fail "app.js sem carregamento do status de sync"
grep -q 'retry-sync' <<< "$app_js" || fail "app.js sem retry de sync"

echo "OK: painel de sincronização, endpoint autenticado e retry manual validados."
