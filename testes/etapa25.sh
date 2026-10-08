#!/usr/bin/env bash
set -u

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
base_url="$TRACE_BASE_URL"
jar="$trace_test_tmp_dir/dx-etapa25-cookies.txt"
rm -f "$jar"
fail() { echo "FAIL: $1"; exit 1; }

login_code="$(curl -sS -o $trace_test_tmp_dir/dx-etapa25-login.json -w '%{http_code}' -c "$jar" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
[ "$login_code" = "200" ] || fail "login retornou HTTP $login_code"
grep -q '"authenticated":true\|"authenticated": true' $trace_test_tmp_dir/dx-etapa25-login.json || fail "login não autenticou"

store_js="$(curl -sS "$base_url/js/classes/ArmazenamentoTrace.js")"
monitoring_js="$(curl -sS "$base_url/telas/alertas/alertas.js")"
operations_js="$(curl -sS "$base_url/telas/romaneio/romaneio.js")"
app_js="$(curl -sS "$base_url/js/aplicacao.js")"
if grep -q 'loadReport' <<< "$store_js"; then fail "histórico operacional ainda está acoplado ao store"; fi
if grep -q 'export-report' <<< "$monitoring_js"; then fail "histórico operacional ainda está acoplado à tela"; fi
grep -q 'data-action="download-audit-report"' <<< "$operations_js" || fail "ação do relatório PDF não está disponível no romaneio"
grep -q '/api/relatorio_auditoria.php?romaneio_id=' <<< "$app_js" || fail "ação do romaneio não chama a API do relatório PDF"

echo "OK: tela de histórico removida; relatório PDF permanece disponível no romaneio."
