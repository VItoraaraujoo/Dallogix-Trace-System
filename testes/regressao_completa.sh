#!/usr/bin/env bash
set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
pass=0
fail_count=0

# Garante uma operação local de teste sem acionar nenhum equipamento físico.
fixture_cookie="/tmp/dallogix-trace-regression-fixture.txt"
base_url="${TRACE_BASE_URL:-http://localhost:8080}"
login="$(curl -sS -c "$fixture_cookie" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if printf '%s' "$login" | grep -q '"authenticated":true'; then
  company_id="$(printf '%s' "$login" | sed -n 's/.*"company_id":\([0-9][0-9]*\).*/\1/p')"
  master_cookie="/tmp/dallogix-trace-regression-master.txt"
  master_login="$(curl -sS -c "$master_cookie" -H 'Content-Type: application/json' -d '{"email":"master@dallogix.local","password":"password"}' "$base_url/api/login.php")"
  master_csrf="$(printf '%s' "$master_login" | sed -n 's/.*"csrf_token":"\([^"]*\)".*/\1/p')"
  if [[ -n "$company_id" && -n "$master_csrf" ]]; then
    curl -sS -b "$master_cookie" -X PUT -H "X-CSRF-Token: $master_csrf" -H 'Content-Type: application/json' \
      -d "{\"company_id\":${company_id},\"status\":\"ATIVA\"}" \
      "$base_url/api/licencas.php" >/dev/null
  fi
  active="$(curl -sS -b "$fixture_cookie" "$base_url/api/carregamentos.php")"
  if ! printf '%s' "$active" | grep -Eq '"state":"(PREPARANDO|CARREGANDO|EMERGENCIA|PAUSADO)"'; then
    number="FIXTURE-$(date +%s%N)"
    plate="FIX$(date +%s%N | tail -c 8)"
    manifest_date="$(date +%Y-%m-%d)"
    manifest="$(curl -sS -b "$fixture_cookie" -H 'Content-Type: application/json' -d "{\"number\":\"$number\",\"scheduled_date\":\"$manifest_date\",\"plate\":\"$plate\",\"product_code\":\"PROD3\",\"planned_quantity\":20}" "$base_url/api/romaneios.php")"
    manifest_id="$(printf '%s' "$manifest" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
    truck_id="$(printf '%s' "$manifest" | sed -n 's/.*"truck_id":\([0-9][0-9]*\).*/\1/p')"
    equipment_ids="$(curl -sS -b "$fixture_cookie" "$base_url/api/equipamentos.php" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const x of (JSON.parse(s).data||[]).reverse()) console.log(x.id)})')"
    prepared=""
    while IFS= read -r equipment_id; do
      [ -n "$equipment_id" ] || continue
      candidate="$(curl -sS -b "$fixture_cookie" -H 'Content-Type: application/json' -d "{\"romaneio_id\":$manifest_id,\"truck_id\":$truck_id,\"equipment_id\":$equipment_id}" "$base_url/api/carregamentos.php")"
      if printf '%s' "$candidate" | grep -q '"state":"PREPARANDO"'; then
        prepared="$candidate"
        break
      fi
    done <<< "$equipment_ids"
    if [[ -z "$prepared" ]]; then
      echo "FAIL: não foi possível criar fixture de carregamento local" >&2
      exit 1
    fi
  fi
fi

for i in $(seq 1 39); do
  test_file="$root/testes/etapa${i}.sh"
  [ -f "$test_file" ] || continue
  # O Nginx limita login a 2 req/s; o intervalo evita falsos 503 entre etapas.
  sleep "${TRACE_REGRESSION_STAGE_DELAY:-1}"
  if bash "$test_file"; then
    pass=$((pass + 1))
  else
    fail_count=$((fail_count + 1))
  fi
done
echo "Resultado da regressão: ${pass} aprovadas; ${fail_count} falhas."
[ "$fail_count" -eq 0 ]
