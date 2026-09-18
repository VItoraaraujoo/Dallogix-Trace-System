#!/usr/bin/env bash

ensure_loading_carregando() {
  local json loading_id prep_id manifest number plate manifest_id truck_id equipment_ids equipment_id prepared gateway_token
  gateway_token="${TRACE_DEVICE_TOKEN:-trace-device-local-token-2026-v1}"
  if [[ "${TRACE_FORCE_NEW_LOADING:-0}" != "1" ]]; then
    json="$(curl -sS -b "$cookie_file" "$base_url/api/carregamentos.php")"
    loading_id="$(printf '%s' "$json" | sed -n 's/.*"id":\([0-9][0-9]*\),"state":"CARREGANDO".*/\1/p' | head -n 1)"
    if [[ -z "$loading_id" ]]; then
      prep_id="$(printf '%s' "$json" | sed -n 's/.*"id":\([0-9][0-9]*\),"state":"PREPARANDO".*/\1/p' | head -n 1)"
      if [[ -n "$prep_id" ]]; then
        equipment_id="$(printf '%s' "$json" | sed -n 's/.*"id":'"$prep_id"',\"state\":\"[^\"]*\",\"equipment_id\":\([0-9][0-9]*\).*/\1/p' | head -n 1)"
        [[ -n "$equipment_id" ]] || equipment_id=1
        curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" \
          -d "{\"equipment_id\":$equipment_id,\"device_type\":\"CLP\",\"status\":\"ONLINE\"}" \
          "$base_url/api/device_heartbeat.php" >/dev/null
        sleep 1
        curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "{\"carregamento_id\":$prep_id,\"state\":\"CARREGANDO\"}" "$base_url/api/estado_carregamento.php" >/dev/null
        loading_id="$prep_id"
      fi
    fi
  fi

  if [[ -z "$loading_id" ]]; then
    number="FIXTURE-$(date +%s%N)"
    plate="FIX$(date +%s%N | tail -c 8)"
    manifest="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' \
      -d "{\"number\":\"$number\",\"scheduled_date\":\"$(date +%F)\",\"plate\":\"$plate\",\"product_code\":\"PROD3\",\"planned_quantity\":2}" \
      "$base_url/api/romaneios.php")"
    manifest_id="$(printf '%s' "$manifest" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
    truck_id="$(printf '%s' "$manifest" | sed -n 's/.*"truck_id":\([0-9][0-9]*\).*/\1/p')"
    if [[ -n "$manifest_id" && -n "$truck_id" ]]; then
      equipment_ids="$(curl -sS -b "$cookie_file" "$base_url/api/equipamentos.php" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const x of (JSON.parse(s).data||[]).reverse()) console.log(x.id)})')"
      while IFS= read -r equipment_id; do
        [[ -n "$equipment_id" ]] || continue
        prepared="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' \
          -d "{\"romaneio_id\":$manifest_id,\"truck_id\":$truck_id,\"equipment_id\":$equipment_id}" \
          "$base_url/api/carregamentos.php")"
        if printf '%s' "$prepared" | grep -q '"state":"PREPARANDO"'; then
          loading_id="$(printf '%s' "$prepared" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
          break
        fi
      done <<< "$equipment_ids"
      if [[ -n "$loading_id" ]]; then
        curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" \
          -d "{\"equipment_id\":$equipment_id,\"device_type\":\"CLP\",\"status\":\"ONLINE\"}" \
          "$base_url/api/device_heartbeat.php" >/dev/null
        sleep 1
        curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' \
          -d "{\"carregamento_id\":$loading_id,\"state\":\"CARREGANDO\"}" \
          "$base_url/api/estado_carregamento.php" >/dev/null
      fi
    fi
  fi

  if [[ -z "$loading_id" ]]; then
    json="$(curl -sS -b "$cookie_file" "$base_url/api/carregamentos.php")"
    loading_id="$(printf '%s' "$json" | sed -n 's/.*"id":\([0-9][0-9]*\),"state":"CARREGANDO".*/\1/p' | head -n 1)"
    if [[ -z "$loading_id" ]]; then
      prep_id="$(printf '%s' "$json" | sed -n 's/.*"id":\([0-9][0-9]*\),"state":"PREPARANDO".*/\1/p' | head -n 1)"
      if [[ -n "$prep_id" ]]; then
        equipment_id="$(printf '%s' "$json" | sed -n 's/.*"id":'"$prep_id"',"state":"[^"]*","equipment_id":\([0-9][0-9]*\).*/\1/p' | head -n 1)"
        [[ -n "$equipment_id" ]] || equipment_id=1
        curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" \
          -d "{\"equipment_id\":$equipment_id,\"device_type\":\"CLP\",\"status\":\"ONLINE\"}" \
          "$base_url/api/device_heartbeat.php" >/dev/null
        sleep 1
        curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' \
          -d "{\"carregamento_id\":$prep_id,\"state\":\"CARREGANDO\"}" \
          "$base_url/api/estado_carregamento.php" >/dev/null
        loading_id="$prep_id"
      fi
    fi
  fi

  printf '%s' "$loading_id"
}
