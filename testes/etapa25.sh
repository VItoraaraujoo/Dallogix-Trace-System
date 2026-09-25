#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
jar="/tmp/dx-etapa25-cookies.txt"
rm -f "$jar"
fail() { echo "FAIL: $1"; exit 1; }

login_code="$(curl -sS -o /tmp/dx-etapa25-login.json -w '%{http_code}' -c "$jar" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
[ "$login_code" = "200" ] || fail "login retornou HTTP $login_code"
grep -q '"authenticated":true\|"authenticated": true' /tmp/dx-etapa25-login.json || fail "login não autenticou"

store_js="$(curl -sS "$base_url/js/classes/ArmazenamentoTrace.js")"
monitoring_js="$(curl -sS "$base_url/js/telas/monitoramento.js")"
operations_js="$(curl -sS "$base_url/js/telas/operacoes.js")"
app_js="$(curl -sS "$base_url/js/aplicacao.js")"
if printf '%s' "$store_js" | grep -q 'loadReport'; then fail "histórico operacional ainda está acoplado ao store"; fi
if printf '%s' "$monitoring_js" | grep -q 'export-report'; then fail "histórico operacional ainda está acoplado à tela"; fi
printf '%s' "$operations_js" | grep -q 'data-action="download-audit-report"' || fail "ação do relatório PDF não está disponível no romaneio"
printf '%s' "$app_js" | grep -q '/api/relatorio_auditoria.php?romaneio_id=' || fail "ação do romaneio não chama a API do relatório PDF"

echo "OK: tela de histórico removida; relatório PDF permanece disponível no romaneio."
