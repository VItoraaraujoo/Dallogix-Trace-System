#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa18-cookie.txt"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi

summary="$(curl -sS -b "$cookie_file" "$base_url/api/resumo_carregamento.php?carregamento_id=1")"
if ! printf '%s' "$summary" | grep -q '"capturas_pendentes"'; then
  echo "FAIL: resumo não retornou capturas pendentes"
  exit 1
fi

finish="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d '{"carregamento_id":1}' "$base_url/api/encerrar_carregamento.php")"
if ! printf '%s' "$finish" | grep -q 'capturas de incidentes pendentes'; then
  echo "FAIL: encerramento ignorou evidências pendentes: $finish"
  exit 1
fi

echo "OK: resumo final disponível e encerramento bloqueia evidências pendentes."
