#!/usr/bin/env bash
set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
pass=0
fail_count=0
fixture_loading_id=""
fixture_equipment_id=""
fixture_manifest_id=""
umask 077
fixture_state_dir="$(mktemp -d "${TMPDIR:-/tmp}/dallogix-trace-regression.XXXXXX")" || {
  echo "FAIL: não foi possível criar a pasta temporária privada da regressão." >&2
  exit 1
}
fixture_cookie="$fixture_state_dir/fixture.cookies"
master_cookie="$fixture_state_dir/master.cookies"
cleanup_fixture_credentials() {
  rm -f "$fixture_cookie" "$master_cookie"
  rmdir "$fixture_state_dir"
}
trap cleanup_fixture_credentials EXIT

# Esta bateria cria um romaneio/carregamento e pode alterar a licença da fixture.
# Exija alvo loopback explícito e confirmação de que ele é descartável para não
# escrever acidentalmente na instalação real padrão em localhost:8080.
if [[ -z "${TRACE_BASE_URL:-}" ]]; then
  echo "FAIL: defina TRACE_BASE_URL para a URL loopback da fixture descartável." >&2
  exit 2
fi
if [[ "${TRACE_REGRESSION_DISPOSABLE:-0}" != "1" ]]; then
  echo "FAIL: confirme a fixture descartável com TRACE_REGRESSION_DISPOSABLE=1." >&2
  exit 2
fi
base_url="${TRACE_BASE_URL%/}"
if [[ ! "$base_url" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]]; then
  echo "FAIL: regressão integrada só pode apontar para uma URL loopback." >&2
  exit 2
fi
export TRACE_BASE_URL="$base_url"
if [[ "${COMPOSE_FILE:-}" != *docker-compose.production-test.yml* || -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
  echo "FAIL: configure COMPOSE_FILE=docker-compose.production-test.yml e um COMPOSE_PROJECT_NAME isolado." >&2
  exit 2
fi
if [[ -z "${TRACE_DEVICE_TOKEN:-}" ]]; then
  echo "FAIL: defina TRACE_DEVICE_TOKEN provisionado somente na fixture descartável." >&2
  exit 2
fi

# Garante uma operação local de teste sem acionar nenhum equipamento físico.
login="$(curl -sS -c "$fixture_cookie" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if printf '%s' "$login" | grep -q '"authenticated":true'; then
  company_id="$(printf '%s' "$login" | sed -n 's/.*"company_id":\([0-9][0-9]*\).*/\1/p')"
  admin_csrf="$(printf '%s' "$login" | sed -n 's/.*"csrf_token":"\([^"]*\)".*/\1/p')"
  if [[ -z "$admin_csrf" ]]; then
    echo "FAIL: login local não retornou token CSRF para a fixture de regressão." >&2
    exit 1
  fi
  master_login="$(curl -sS -c "$master_cookie" -H 'Content-Type: application/json' -d '{"email":"master@dallogix.local","password":"password"}' "$base_url/api/login.php")"
  master_csrf="$(printf '%s' "$master_login" | sed -n 's/.*"csrf_token":"\([^"]*\)".*/\1/p')"
  if [[ -n "$company_id" && -n "$master_csrf" ]]; then
    curl -sS -b "$master_cookie" -X PUT -H "X-CSRF-Token: $master_csrf" -H 'Content-Type: application/json' \
      -d "{\"company_id\":${company_id},\"status\":\"ATIVA\"}" \
      "$base_url/api/licencas.php" >/dev/null
  fi
  if [[ "${TRACE_REGRESSION_PROVISION_DEVICES:-0}" == "1" ]]; then
    regression_equipment_id="$(curl -sS -b "$fixture_cookie" "$base_url/api/equipamentos.php" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=(JSON.parse(s).data||[])[0];if(x)process.stdout.write(String(x.id))})')"
    if [[ -z "$regression_equipment_id" || -z "${TRACE_DEVICE_TOKEN:-}" ]]; then
      echo "FAIL: credenciais ou equipamento ausentes para provisionar os dispositivos de teste" >&2
      exit 1
    fi
    docker compose exec -T php php /var/www/scripts/provision_device.php \
      --equipment-id="$regression_equipment_id" --device-type=CLP \
      --device-code=PLC-EST-001 --token="$TRACE_DEVICE_TOKEN" >/dev/null
    export TRACE_EQUIPMENT_ID="$regression_equipment_id"
  fi
  active="$(curl -sS -b "$fixture_cookie" "$base_url/api/carregamentos.php")"
  if ! printf '%s' "$active" | grep -Eq '"state":"(PREPARANDO|CARREGANDO|EMERGENCIA|PAUSADO)"'; then
    number="FIXTURE-$(date +%s%N)"
    plate="FIX$(date +%s%N | tail -c 8)"
    manifest_date="$(date +%Y-%m-%d)"
    manifest="$(curl -sS -b "$fixture_cookie" -H "X-CSRF-Token: $admin_csrf" -H 'Content-Type: application/json' -d "{\"number\":\"$number\",\"scheduled_date\":\"$manifest_date\",\"plate\":\"$plate\",\"product_code\":\"PROD3\",\"planned_quantity\":20}" "$base_url/api/romaneios.php")"
    manifest_id="$(printf '%s' "$manifest" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
    fixture_manifest_id="$manifest_id"
    truck_id="$(printf '%s' "$manifest" | sed -n 's/.*"truck_id":\([0-9][0-9]*\).*/\1/p')"
    equipment_ids="$(curl -sS -b "$fixture_cookie" "$base_url/api/equipamentos.php" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const x of (JSON.parse(s).data||[]).reverse()) console.log(x.id)})')"
    prepared=""
    while IFS= read -r equipment_id; do
      [ -n "$equipment_id" ] || continue
      candidate="$(curl -sS -b "$fixture_cookie" -H "X-CSRF-Token: $admin_csrf" -H 'Content-Type: application/json' -d "{\"romaneio_id\":$manifest_id,\"truck_id\":$truck_id,\"equipment_id\":$equipment_id}" "$base_url/api/carregamentos.php")"
      if printf '%s' "$candidate" | grep -q '"state":"PREPARANDO"'; then
        prepared="$candidate"
        break
      fi
    done <<< "$equipment_ids"
    if [[ -z "$prepared" ]]; then
      echo "FAIL: não foi possível criar fixture de carregamento local" >&2
      exit 1
    fi
    loading_id="$(printf '%s' "$prepared" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
    fixture_loading_id="$loading_id"
    fixture_equipment_id="$equipment_id"
    if [[ -n "$loading_id" && -n "${TRACE_DEVICE_TOKEN:-}" ]]; then
      curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: ${TRACE_DEVICE_TOKEN}" \
        -d "{\"equipment_id\":${equipment_id},\"device_type\":\"CLP\",\"status\":\"ONLINE\"}" \
        "$base_url/api/device_heartbeat.php" >/dev/null
      curl -sS -b "$fixture_cookie" -X PATCH -H "X-CSRF-Token: $admin_csrf" -H 'Content-Type: application/json' \
        -d "{\"carregamento_id\":${loading_id},\"state\":\"CARREGANDO\"}" \
        "$base_url/api/estado_carregamento.php" >/dev/null
    fi
  fi
fi

for i in $(seq 1 39); do
  test_file="$root/testes/etapa${i}.sh"
  [ -f "$test_file" ] || continue
  if [[ "$i" -eq 30 && -n "$fixture_loading_id" ]]; then
    fixture_state="$(curl -sS -b "$fixture_cookie" "$base_url/api/carregamentos.php" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const id=Number(process.argv[1]);const row=(JSON.parse(s).data||[]).find(item=>Number(item.id)===id);if(row)process.stdout.write(`${row.state}|${row.equipment_id}`)})' "$fixture_loading_id")"
    if [[ -n "$fixture_state" ]]; then
      IFS='|' read -r current_state fixture_equipment_id <<< "$fixture_state"
      if [[ "$current_state" == "CARREGANDO" ]]; then
        heartbeat="$(curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $TRACE_DEVICE_TOKEN" -d "{\"equipment_id\":$fixture_equipment_id,\"device_type\":\"CLP\",\"status\":\"ONLINE\"}" "$base_url/api/device_heartbeat.php")"
        if ! printf '%s' "$heartbeat" | grep -q '"status":"ONLINE"'; then
          echo "FAIL: não foi possível renovar o heartbeat da fixture antes da etapa 30: $heartbeat" >&2
          exit 1
        fi
        paused="$(curl -sS -b "$fixture_cookie" -X PATCH -H "X-CSRF-Token: $admin_csrf" -H 'Content-Type: application/json' -d "{\"carregamento_id\":$fixture_loading_id,\"state\":\"PAUSADO\"}" "$base_url/api/estado_carregamento.php")"
        if ! printf '%s' "$paused" | grep -q '"state":"PAUSADO"'; then
          echo "FAIL: não foi possível pausar a fixture antes do cancelamento: $paused" >&2
          exit 1
        fi
        current_state="PAUSADO"
      fi
      if [[ ! "$current_state" =~ ^(PREPARANDO|PAUSADO|EMERGENCIA)$ ]]; then
        echo "FAIL: estado inesperado da fixture antes da etapa 30: $current_state" >&2
        exit 1
      fi
      cancelled="$(curl -sS -b "$fixture_cookie" -X PATCH -H "X-CSRF-Token: $admin_csrf" -H 'Content-Type: application/json' -d "{\"action\":\"cancel\",\"romaneio_id\":$fixture_manifest_id,\"justification\":\"Fixture integrada descartável liberada para as etapas 30 a 39.\"}" "$base_url/api/romaneios.php")"
      if ! printf '%s' "$cancelled" | grep -q '"status":"CANCELADO"'; then
        echo "FAIL: não foi possível cancelar o romaneio da fixture antes da etapa 30: $cancelled" >&2
        exit 1
      fi
    fi
  fi
  # O backend limita tentativas por IP a 30/min; manter intervalo evita que
  # a própria bateria de homologação acione a proteção legítima.
  sleep "${TRACE_REGRESSION_STAGE_DELAY:-3}"
  echo "[Etapa ${i}/39] ${test_file##*/}"
  if bash "$test_file"; then
    pass=$((pass + 1))
    echo "[Etapa ${i}/39] APROVADA"
  else
    fail_count=$((fail_count + 1))
    echo "[Etapa ${i}/39] FALHOU"
  fi
done
echo "Resultado da regressão: ${pass} aprovadas; ${fail_count} falhas."
[ "$fail_count" -eq 0 ]
