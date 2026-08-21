#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa16-cookie.txt"
event_uuid="33333333-3333-4333-8333-$(printf '%012d' "$(date +%s)")"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi

event="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"carregamento_id\":1,\"equipment_id\":1,\"event_uuid\":\"$event_uuid\"}" "$base_url/api/sensor_eventos.php")"
if ! printf '%s' "$event" | grep -q '"camera_trigger":"IMEDIATO"'; then
  echo "FAIL: câmera não foi disparada no evento do sensor: $event"
  exit 1
fi

requests="$(curl -sS -b "$cookie_file" "$base_url/api/camera_requests.php")"
if ! printf '%s' "$requests" | grep -q '"status":"PENDENTE"'; then
  echo "FAIL: pedido de captura não ficou disponível: $requests"
  exit 1
fi

echo "OK: captura de câmera solicitada imediatamente no evento do sensor."
