#!/usr/bin/env bash
set -u
source "$(cd "$(dirname "$0")" && pwd)/lib/csrf.sh"

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
trace_exigir_compose_producao_teste
base_url="$TRACE_BASE_URL"
gateway_token="${TRACE_DEVICE_TOKEN:-}"
cookie_file="$trace_test_tmp_dir/dallogix-trace-etapa38-cookie.txt"
equipment_id="${TRACE_TEST_EQUIPMENT_ID:-$(trace_test_mysql_query app "SELECT e.id FROM equipamentos e WHERE NOT EXISTS (SELECT 1 FROM carregamentos c WHERE c.equipment_id = e.id AND c.state <> 'FINALIZADO') ORDER BY e.id LIMIT 1" 2>/dev/null | tr -d '\r' | head -n 1)}"
fail() { echo "FAIL: $1"; exit 1; }

[ -n "$equipment_id" ] || fail "nenhuma Dala livre para o teste"

test_admin_email="${TRACE_TEST_ADMIN_EMAIL:-admin@dallogix.local}"
test_admin_password="${TRACE_TEST_ADMIN_PASSWORD:-password}"
login_payload="$(node -e 'const [email,password]=process.argv.slice(1);process.stdout.write(JSON.stringify({email,password}))' "$test_admin_email" "$test_admin_password")"
login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d "$login_payload" "$base_url/api/login.php")"
printf '%s' "$login" | grep -q '"authenticated":true' || fail "login falhou"
csrf_header="$(trace_csrf_header "$login")" || fail "login sem CSRF"

stamp="$(date +%s)"
product_b_code="A01-${stamp}"
product_b_barcode="789${stamp}"
product_b="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"name\":\"Produto A01 ${stamp}\",\"code\":\"${product_b_code}\",\"barcode\":\"${product_b_barcode}\"}" "$base_url/api/produtos.php")"
product_b_id="$(printf '%s' "$product_b" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
[ -n "$product_b_id" ] || fail "segundo produto não foi criado: $product_b"

product_a_id="$(curl -sS -b "$cookie_file" "$base_url/api/produtos.php" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=(JSON.parse(s).data||[]).find(x=>x.code==="PROD3");process.stdout.write(p?String(p.id):"")})')"
[ -n "$product_a_id" ] || fail "produto PROD3 não encontrado"

number="A01-${stamp}"
manifest="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"number\":\"${number}\",\"scheduled_date\":\"$(date +%F)\",\"plate\":\"A01${stamp:(-5)}\",\"product_code\":\"PROD3\",\"planned_quantity\":1}" "$base_url/api/romaneios.php")"
manifest_id="$(printf '%s' "$manifest" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
truck_id="$(printf '%s' "$manifest" | sed -n 's/.*"truck_id":\([0-9][0-9]*\).*/\1/p')"
[ -n "$manifest_id" ] && [ -n "$truck_id" ] || fail "romaneio não foi criado: $manifest"

updated="$(curl -sS -b "$cookie_file" -X PATCH -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"action\":\"update\",\"romaneio_id\":${manifest_id},\"number\":\"${number}\",\"scheduled_date\":\"$(date +%F)\",\"plate\":\"A01${stamp:(-5)}\",\"items\":[{\"product_id\":${product_a_id},\"quantity\":1},{\"product_id\":${product_b_id},\"quantity\":2}]}" "$base_url/api/romaneios.php")"
printf '%s' "$updated" | grep -q "\"id\":${manifest_id}" || fail "romaneio com dois produtos não foi salvo: $updated"

prepared="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"romaneio_id\":${manifest_id},\"truck_id\":${truck_id},\"equipment_id\":${equipment_id}}" "$base_url/api/carregamentos.php")"
loading_id="$(printf '%s' "$prepared" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
[ -n "$loading_id" ] || fail "carregamento não foi preparado: $prepared"

heartbeat="$(curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" -d "{\"equipment_id\":$equipment_id,\"device_type\":\"CLP\",\"status\":\"ONLINE\"}" "$base_url/api/device_heartbeat.php")"
printf '%s' "$heartbeat" | grep -q '"status":"ONLINE"' || fail "heartbeat do CLP de teste não foi aceito: $heartbeat"
started="$(curl -sS -b "$cookie_file" -X PATCH -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"state\":\"CARREGANDO\"}" "$base_url/api/estado_carregamento.php")"
printf '%s' "$started" | grep -q '"state":"CARREGANDO"' || fail "carregamento não iniciou: $started"

first="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"barcode\":\"7898250782592\"}" "$base_url/api/leituras.php")"
printf '%s' "$first" | grep -q '"result":"VALIDO"' || fail "primeira unidade válida não foi aceita: $first"

second="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"barcode\":\"7898250782592\"}" "$base_url/api/leituras.php")"
printf '%s' "$second" | grep -q '"result":"EXCESSO"' || fail "excesso do produto A não foi detectado por item: $second"
pause_request_id="$(printf '%s' "$second" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);process.stdout.write(String(r.data?.pause_command_request_id||""))})')"
[ -n "$pause_request_id" ] || fail "a divergência não criou pedido de parada no gateway: $second"
pause_request="$(trace_test_mysql_query app "SELECT CONCAT(command, ':', status) FROM solicitacoes_comandos_clp WHERE id = ${pause_request_id} AND carregamento_id = ${loading_id}")"
[ "$pause_request" = "PAUSAR_CARREGAMENTO:PENDENTE" ] || fail "pedido de parada não ficou pendente no ambiente sem gateway: $pause_request"
active_loadings="$(curl -sS -b "$cookie_file" "$base_url/api/carregamentos.php")"
printf '%s' "$active_loadings" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const id=Number(process.argv[1]);const row=(JSON.parse(s).data||[]).find(x=>Number(x.id)===id);if(!row||row.stop_reason!=="EXCESSO"||!row.operator_alert)process.exitCode=1})' "$loading_id" || fail "o snapshot ativo não entregou o motivo e o alerta de parada: $active_loadings"
blocked_start="$(curl -sS -o "$trace_test_tmp_dir/dallogix-trace-etapa38-blocked-start.json" -w '%{http_code}' -b "$cookie_file" -X PATCH -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"state\":\"CARREGANDO\"}" "$base_url/api/estado_carregamento.php")"
[ "$blocked_start" = "409" ] || fail "retomada sem confirmar remoção/parada deveria retornar 409, recebeu $blocked_start"
unconfirmed="$(curl -sS -o "$trace_test_tmp_dir/dallogix-trace-etapa38-unconfirmed.json" -w '%{http_code}' -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id}}" "$base_url/api/confirmar_remocao.php")"
[ "$unconfirmed" = "422" ] || fail "confirmação sem atestado explícito deveria retornar 422, recebeu $unconfirmed"
# Simula a pequena janela entre limpar o alerta e cancelar a ordem pendente.
# O start precisa continuar bloqueado tanto na rota de comandos como na
# alteração genérica de estado, sem fingir que o gateway confirmou a parada.
trace_test_mysql_query app "UPDATE carregamentos SET stop_reason = NULL, operator_alert = NULL WHERE id = ${loading_id}" >/dev/null
pending_pause_start="$(curl -sS -o "$trace_test_tmp_dir/dallogix-trace-etapa38-pending-pause-start.json" -w '%{http_code}' -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"command\":\"INICIAR_CARREGAMENTO\"}" "$base_url/api/comando_maquina.php")"
[ "$pending_pause_start" = "409" ] || fail "comando de início substituiu uma parada pendente: HTTP $pending_pause_start"
grep -q 'Aguarde o gateway confirmar ou cancelar a parada' "$trace_test_tmp_dir/dallogix-trace-etapa38-pending-pause-start.json" || fail "comando de início não informou o bloqueio pela parada pendente"
pending_pause_state="$(curl -sS -o "$trace_test_tmp_dir/dallogix-trace-etapa38-pending-pause-state.json" -w '%{http_code}' -b "$cookie_file" -X PATCH -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"state\":\"CARREGANDO\"}" "$base_url/api/estado_carregamento.php")"
[ "$pending_pause_state" = "409" ] || fail "alteração genérica de estado ignorou parada pendente: HTTP $pending_pause_state"
trace_test_mysql_query app "UPDATE carregamentos SET stop_reason = 'EXCESSO', operator_alert = 'Remova a unidade excedente e confirme para continuar.' WHERE id = ${loading_id}" >/dev/null
confirmed="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"confirmar_remocao\":true}" "$base_url/api/confirmar_remocao.php")"
printf '%s' "$confirmed" | grep -q '"confirmed":true' || fail "confirmação da remoção/parada falhou: $confirmed"
pause_request_after_confirmation="$(trace_test_mysql_query app "SELECT CONCAT(command, ':', status) FROM solicitacoes_comandos_clp WHERE id = ${pause_request_id} AND carregamento_id = ${loading_id}")"
[ "$pause_request_after_confirmation" = "PAUSAR_CARREGAMENTO:REJEITADO" ] || fail "comando ainda não reservado não foi cancelado após a confirmação: $pause_request_after_confirmation"

# A fixture é descartável; finalize-a para não bloquear as etapas seguintes
# por ocupação da única Dala disponível no ambiente local.
curl -sS -b "$cookie_file" -X PATCH -H "$csrf_header" -H 'Content-Type: application/json' \
  -d "{\"carregamento_id\":${loading_id},\"state\":\"CARREGANDO\"}" \
  "$base_url/api/estado_carregamento.php" >/dev/null
curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' \
  -d "{\"carregamento_id\":${loading_id},\"justification\":\"Fixture da etapa 38 finalizada.\"}" \
  "$base_url/api/encerrar_carregamento.php" >/dev/null

echo "OK: quantidade planejada foi aplicada por produto; A excedido não bloqueia indevidamente o produto B."
