#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa5-cookie.txt"
event_uuid="22222222-2222-4222-8222-$(printf '%012d' "$(date +%s)")"

status() {
  curl -sS -o /dev/null -w '%{http_code}' "$@"
}

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi

valid="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"carregamento_id":1,"barcode":"7898250782592"}' "$base_url/api/leituras.php")"
if ! printf '%s' "$valid" | grep -q '"result":"VALIDO"'; then
  echo "FAIL: barcode válido não foi aceito: $valid"
  exit 1
fi

invalid="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"carregamento_id":1,"barcode":"0000000000000"}' "$base_url/api/leituras.php")"
if ! printf '%s' "$invalid" | grep -q '"result":"PRODUTO_INCORRETO"'; then
  echo "FAIL: barcode incorreto não foi classificado: $invalid"
  exit 1
fi

event="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"carregamento_id\":1,\"equipment_id\":1,\"event_uuid\":\"$event_uuid\"}" "$base_url/api/sensor_eventos.php")"
if ! printf '%s' "$event" | grep -q '"duplicate":false'; then
  echo "FAIL: evento novo não foi criado: $event"
  exit 1
fi

duplicate="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"carregamento_id\":1,\"equipment_id\":1,\"event_uuid\":\"$event_uuid\"}" "$base_url/api/sensor_eventos.php")"
if ! printf '%s' "$duplicate" | grep -q '"duplicate":true'; then
  echo "FAIL: evento repetido não foi tratado com idempotência: $duplicate"
  exit 1
fi

if [[ "$(status -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"carregamento_id":1,"state":"CARREGANDO"}' "$base_url/api/estado_carregamento.php")" != "200" ]]; then
  echo "FAIL: transição válida não foi aceita"
  exit 1
fi

if [[ "$(status -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"carregamento_id":1,"state":"PREPARANDO"}' "$base_url/api/estado_carregamento.php")" != "409" ]]; then
  echo "FAIL: transição inválida foi aceita"
  exit 1
fi

echo "OK: leitura válida/incorreta, evento idempotente e máquina de estados validados."
