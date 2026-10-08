#!/usr/bin/env bash
set -u
source "$(cd "$(dirname "$0")" && pwd)/lib/csrf.sh"

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
trace_exigir_compose_producao_teste
base_url="$TRACE_BASE_URL"
cookie_file="$trace_test_tmp_dir/dallogix-trace-etapa12-cookie.txt"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi
csrf_header="$(trace_csrf_header "$login")" || exit 1

before="$(trace_test_mysql_query root 'SELECT COUNT(*) FROM romaneios;' 2>/dev/null)"
response="$(curl -sS -b "$cookie_file" -H "$csrf_header" -F 'file=@testes/fixtures/import-etapa12-invalido.csv' "$base_url/api/importar_csv.php")"
if ! printf '%s' "$response" | grep -q 'Produto PRODUTO-QUE-NAO-EXISTE'; then
  echo "FAIL: CSV inválido não foi rejeitado: $response"
  exit 1
fi

after="$(trace_test_mysql_query root 'SELECT COUNT(*) FROM romaneios;' 2>/dev/null)"
if [[ "$before" != "$after" ]]; then
  echo "FAIL: rollback não preservou a contagem ($before -> $after)"
  exit 1
fi

echo "OK: CSV inválido rejeitado e rollback confirmado ($after romaneios)."
