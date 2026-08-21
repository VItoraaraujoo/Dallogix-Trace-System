#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-sim-clp-cookie.txt"
loading_id="${TRACE_LOADING_ID:-1}"
equipment_id="${TRACE_EQUIPMENT_ID:-1}"
barcode="${1:-7898250782592}"
event_suffix="$(printf '%04x%08x' "$RANDOM" "$(date +%s)")"
event_uuid="88888888-8888-4888-8888-${event_suffix}"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "Falha no login do simulador: $login"
  exit 1
fi

state="$(curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"state\":\"CARREGANDO\"}" "$base_url/api/estado_carregamento.php")"
echo "CLP estado: $state"

event="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"equipment_id\":${equipment_id},\"event_uuid\":\"${event_uuid}\"}" "$base_url/api/sensor_eventos.php")"
event_id="$(printf '%s' "$event" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
if [[ -z "$event_id" ]]; then
  echo "Falha no sensor simulado: $event"
  exit 1
fi
echo "Sensor detectou saco: evento ${event_id}"

if [[ "$barcode" == "SEM_LEITURA" ]]; then
  reading="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"sensor_event_id\":${event_id}}" "$base_url/api/leituras.php")"
else
  reading="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"sensor_event_id\":${event_id},\"barcode\":\"${barcode}\"}" "$base_url/api/leituras.php")"
fi
echo "Scanner simulado: $reading"
echo "Simulação concluída."
