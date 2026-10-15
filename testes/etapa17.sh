#!/usr/bin/env bash
set -u
source "$(cd "$(dirname "$0")" && pwd)/lib/csrf.sh"

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
trace_exigir_compose_producao_teste
base_url="$TRACE_BASE_URL"
gateway_token="${TRACE_DEVICE_TOKEN:-}"
cookie_file="$trace_test_tmp_dir/dallogix-trace-etapa17-cookie.txt"
source "$(cd "$(dirname "$0")" && pwd)/lib/ensure_loading.sh"
normal_uuid="66666666-6666-4666-8666-$(printf '%012d' "$(date +%s)")"
incident_uuid="77777777-7777-4777-8777-$(printf '%012d' "$(date +%s)")"
test_admin_email="${TRACE_TEST_ADMIN_EMAIL:-admin@dallogix.local}"
test_admin_password="${TRACE_TEST_ADMIN_PASSWORD:-password}"

login_payload="$(node -e 'const [email,password]=process.argv.slice(1);process.stdout.write(JSON.stringify({email,password}))' "$test_admin_email" "$test_admin_password")"
login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d "$login_payload" "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi
csrf_header="$(trace_csrf_header "$login")" || exit 1

if [[ -n "${TRACE_LOADING_ID:-}" ]]; then
  loading_id="$TRACE_LOADING_ID"
else
  TRACE_FORCE_NEW_LOADING=1 loading_id="$(ensure_loading_carregando)"
fi
[ -n "$loading_id" ] || { echo "FAIL: nenhum carregamento CARREGANDO disponível"; exit 1; }
equipment_id="${TRACE_EQUIPMENT_ID:-$(curl -sS -b "$cookie_file" "$base_url/api/carregamentos.php" | sed -n 's/.*"id":'"$loading_id"',"state":"[^"]*","equipment_id":\([0-9][0-9]*\).*/\1/p' | head -n 1)}"

normal="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" -d "{\"carregamento_id\":$loading_id,\"equipment_id\":$equipment_id,\"event_uuid\":\"$normal_uuid\"}" "$base_url/api/sensor_eventos.php")"
normal_id="$(printf '%s' "$normal" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
valid="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":$loading_id,\"sensor_event_id\":$normal_id,\"barcode\":\"7898250782592\"}" "$base_url/api/leituras.php")"
if ! printf '%s' "$valid" | grep -q 'NAO_SOLICITADA'; then
  echo "FAIL: leitura válida não deveria solicitar foto: $valid"
  exit 1
fi

sleep 1
incident="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" -d "{\"carregamento_id\":$loading_id,\"equipment_id\":$equipment_id,\"event_uuid\":\"$incident_uuid\"}" "$base_url/api/sensor_eventos.php")"
incident_id="$(printf '%s' "$incident" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
failed="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":$loading_id,\"sensor_event_id\":$incident_id}" "$base_url/api/leituras.php")"
if ! printf '%s' "$failed" | grep -q 'CAPTURA_PENDENTE_INCIDENTE'; then
  echo "FAIL: captura do incidente não permaneceu pendente: $failed"
  exit 1
fi
if ! printf '%s' "$failed" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data||{};if(d.result!=="SEM_LEITURA"||d.load_status!=="EM_ANDAMENTO"||d.pause_command_request_id!==null)process.exitCode=1})'; then
  echo "FAIL: SEM_LEITURA não manteve o carregamento em andamento sem pedir pausa: $failed"
  exit 1
fi

loading_state="$(trace_test_mysql_query app "SELECT state FROM carregamentos WHERE id = ${loading_id}")"
if [[ "$loading_state" != "CARREGANDO" ]]; then
  echo "FAIL: SEM_LEITURA alterou o estado do carregamento para $loading_state"
  exit 1
fi
pause_requests="$(trace_test_mysql_query app "SELECT COUNT(*) FROM solicitacoes_comandos_clp WHERE carregamento_id = ${loading_id} AND command = 'PAUSAR_CARREGAMENTO'")"
if [[ "$pause_requests" != "0" ]]; then
  echo "FAIL: SEM_LEITURA criou $pause_requests pedido(s) de pausa"
  exit 1
fi

requests="$(curl -sS -b "$cookie_file" "$base_url/api/camera_requests.php")"
if ! printf '%s' "$requests" | grep -q '"reason":"SEM_LEITURA"'; then
  echo "FAIL: pedido de foto não registrou o motivo do incidente: $requests"
  exit 1
fi

echo "OK: leitura válida não solicita foto; SEM_LEITURA solicita foto e mantém o carregamento ativo sem comando de pausa."
