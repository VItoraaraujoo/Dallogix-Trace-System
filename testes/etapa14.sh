#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
gateway_token="${TRACE_DEVICE_TOKEN:-}"
cookie_file="/tmp/dallogix-trace-etapa14-cookie.txt"

if [[ -z "$gateway_token" ]]; then
  echo "FAIL: defina TRACE_DEVICE_TOKEN com o token provisionado para a Dala"
  exit 1
fi

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi

equipment_id="${TRACE_EQUIPMENT_ID:-$(curl -sS -b "$cookie_file" "$base_url/api/equipamentos.php" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=(JSON.parse(s).data||[])[0];if(e)process.stdout.write(String(e.id))})')}"
if [[ -z "$equipment_id" ]]; then
  echo "FAIL: equipamento de teste ausente"
  exit 1
fi

heartbeat="$(curl -sS -H 'Content-Type: application/json' -H "X-Device-Token: $gateway_token" -d "{\"equipment_id\":$equipment_id,\"device_type\":\"CLP\",\"status\":\"ONLINE\",\"details\":{\"source\":\"teste\"}}" "$base_url/api/device_heartbeat.php")"
if ! printf '%s' "$heartbeat" | grep -q '"status":"ONLINE"'; then
  echo "FAIL: heartbeat não foi aceito: $heartbeat"
  exit 1
fi

devices="$(curl -sS -b "$cookie_file" "$base_url/api/dispositivos.php")"
if ! printf '%s' "$devices" | grep -q '"device_type":"CLP"'; then
  echo "FAIL: dispositivo não apareceu na consulta"
  exit 1
fi

monitoring="$(curl -sS -b "$cookie_file" "$base_url/api/monitoramento.php")"
if ! printf '%s' "$monitoring" | grep -q '"dispositivos"'; then
  echo "FAIL: dispositivo não apareceu no monitoramento"
  exit 1
fi

echo "OK: heartbeat autenticado e status dos dispositivos listados e monitorados."
