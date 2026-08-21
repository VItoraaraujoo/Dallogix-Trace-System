#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa20-cookie.txt"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi

state="$(curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"carregamento_id":1,"state":"CARREGANDO"}' "$base_url/api/estado_carregamento.php")"
if ! printf '%s' "$state" | grep -q '"state":"CARREGANDO"'; then
  echo "FAIL: não foi possível preparar o carregamento: $state"
  exit 1
fi

emergency="$(curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"carregamento_id":1,"state":"EMERGENCIA"}' "$base_url/api/estado_carregamento.php")"
if ! printf '%s' "$emergency" | grep -q '"state":"EMERGENCIA"'; then
  echo "FAIL: emergência não foi ativada: $emergency"
  exit 1
fi

unlock="$(curl -sS -b "$cookie_file" -X POST -H 'Content-Type: application/json' -d '{"carregamento_id":1}' "$base_url/api/desbloquear_maquina.php")"
if ! printf '%s' "$unlock" | grep -q '"command":"DESBLOQUEAR_MAQUINA"'; then
  echo "FAIL: desbloqueio não foi aceito: $unlock"
  exit 1
fi
if ! printf '%s' "$unlock" | grep -q '"state":"PREPARANDO"'; then
  echo "FAIL: máquina não voltou para PREPARANDO: $unlock"
  exit 1
fi

# Deixa a fixture no estado esperado pelas etapas seguintes da regressão.
curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d '{"carregamento_id":1,"state":"CARREGANDO"}' "$base_url/api/estado_carregamento.php" >/dev/null

echo "OK: botão/API de desbloqueio liberam emergência, retornam a PREPARANDO e registram comando."
