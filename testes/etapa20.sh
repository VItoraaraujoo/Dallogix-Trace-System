#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
gateway_token="${TRACE_DEVICE_TOKEN:-}"
cookie_file="/tmp/dallogix-trace-etapa20-cookie.txt"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi

loading_id="${TRACE_LOADING_ID:-$(curl -sS -b "$cookie_file" "$base_url/api/carregamentos.php" | sed -n 's/.*"id":\([0-9][0-9]*\),"state":"CARREGANDO".*/\1/p' | head -n 1)}"
[ -n "$loading_id" ] || { echo "FAIL: nenhum carregamento ativo disponível"; exit 1; }
equipment_id="${TRACE_EQUIPMENT_ID:-$(curl -sS -b "$cookie_file" "$base_url/api/carregamentos.php" | sed -n 's/.*"id":'"$loading_id"',"state":"[^"]*","equipment_id":\([0-9][0-9]*\).*/\1/p' | head -n 1)}"
[ -n "$equipment_id" ] || equipment_id=1

curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" -d "{\"equipment_id\":$equipment_id,\"device_type\":\"CLP\",\"status\":\"ONLINE\"}" "$base_url/api/device_heartbeat.php" >/dev/null

emergency="$(curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "{\"carregamento_id\":$loading_id,\"state\":\"EMERGENCIA\"}" "$base_url/api/estado_carregamento.php")"
if ! printf '%s' "$emergency" | grep -q '"state":"EMERGENCIA"'; then
  echo "FAIL: emergência não foi ativada: $emergency"
  exit 1
fi

# A transição para emergência também gera o comando de intertravamento. O
# gateway industrial precisa consumi-lo antes do desbloqueio solicitado pelo
# operador; caso contrário o teste poderia reservar o comando anterior.
emergency_command="$(curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" -d "{\"action\":\"CLAIM\",\"equipment_id\":$equipment_id}" "$base_url/api/plc_gateway.php")"
emergency_request_id="$(printf '%s' "$emergency_command" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
if [[ -n "$emergency_request_id" ]]; then
  curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" \
    -d "{\"action\":\"COMPLETE\",\"request_id\":$emergency_request_id,\"status\":\"APLICADO\",\"message\":\"Intertravamento de emergência confirmado no teste\"}" \
    "$base_url/api/plc_gateway.php" >/dev/null
fi

unlock="$(curl -sS -b "$cookie_file" -X POST -H 'Content-Type: application/json' -d "{\"carregamento_id\":$loading_id}" "$base_url/api/desbloquear_maquina.php")"
if ! printf '%s' "$unlock" | grep -q '"command":"DESBLOQUEAR_MAQUINA"'; then
  echo "FAIL: desbloqueio não foi aceito: $unlock"
  exit 1
fi
if ! printf '%s' "$unlock" | grep -q '"state":"EMERGENCIA"'; then
  echo "FAIL: desbloqueio alterou o estado antes da confirmação do gateway: $unlock"
  exit 1
fi
request_id="$(printf '%s' "$unlock" | sed -n 's/.*"command_request_id":\([0-9][0-9]*\).*/\1/p')"
[ -n "$request_id" ] || { echo "FAIL: solicitação de desbloqueio não foi criada"; exit 1; }
claimed_unlock="$(curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" -d "{\"action\":\"CLAIM\",\"equipment_id\":$equipment_id}" "$base_url/api/plc_gateway.php")"
printf '%s' "$claimed_unlock" | grep -q "\"id\":$request_id" || { echo "FAIL: gateway não reservou desbloqueio: $claimed_unlock"; exit 1; }
completed_unlock="$(curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" -d "{\"action\":\"COMPLETE\",\"request_id\":$request_id,\"status\":\"APLICADO\",\"message\":\"Intertravamentos confirmados no teste\"}" "$base_url/api/plc_gateway.php")"
printf '%s' "$completed_unlock" | grep -q '"status":"APLICADO"' || { echo "FAIL: gateway não confirmou desbloqueio: $completed_unlock"; exit 1; }

# Processa as evidências da própria fixture no worker simulado e encerra a
# operação, liberando a Dala para as etapas de preparação seguintes.
camera_fixture="$(mktemp)"
trap 'rm -f "$camera_fixture"' EXIT
php -r 'file_put_contents($argv[1], base64_decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/NssAAAAASUVORK5CYII=", true));' "$camera_fixture"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  claim="$(curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: ${CAMERA_DEVICE_TOKEN:-}" -d '{"action":"CLAIM"}' "$base_url/api/camera_worker.php" || true)"
  request_id="$(printf '%s' "$claim" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
  [ -n "$request_id" ] || break
  uploaded="$(curl -sS -H "X-Device-Token: ${CAMERA_DEVICE_TOKEN:-}" \
    -F "request_id=${request_id}" -F "file=@${camera_fixture};type=image/png" \
    "$base_url/api/camera_upload.php")"
  image_path="$(printf '%s' "$uploaded" | php -r '$v=json_decode(stream_get_contents(STDIN),true); echo $v["data"]["image_path"]??"";')"
  [ -n "$image_path" ] || { echo "FAIL: upload da evidência: $uploaded"; exit 1; }
  completed="$(curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: ${CAMERA_DEVICE_TOKEN:-}" \
    -d "{\"action\":\"COMPLETE\",\"request_id\":${request_id},\"image_path\":\"${image_path}\"}" \
    "$base_url/api/camera_worker.php")"
  printf '%s' "$completed" | grep -q '"status":"CAPTURADA"' || { echo "FAIL: captura não confirmada: $completed"; exit 1; }
done
curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "{\"carregamento_id\":$loading_id,\"state\":\"CARREGANDO\"}" "$base_url/api/estado_carregamento.php" >/dev/null
  curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"carregamento_id\":$loading_id,\"justification\":\"Fixture local de teste encerrada pelo cenário de emergência.\"}" "$base_url/api/encerrar_carregamento.php" >/dev/null

echo "OK: botão/API de desbloqueio liberam emergência, retornam a PREPARANDO e registram comando."
