#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa15-cookie.txt"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi

first="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"carregamento_id":1}' "$base_url/api/leituras.php")"
if ! printf '%s' "$first" | grep -q '"result":"SEM_LEITURA"'; then
  echo "FAIL: falha sem leitura não foi registrada: $first"
  exit 1
fi
if ! printf '%s' "$first" | grep -q '"occurrence_id":'; then
  echo "FAIL: ocorrência automática não foi criada: $first"
  exit 1
fi

if ! printf '%s' "$first" | grep -q '"final":true'; then
  echo "FAIL: falha sem leitura não foi encerrada: $first"
  exit 1
fi

echo "OK: saco sem leitura encerrado, ocorrência criada e câmera sinalizada."
