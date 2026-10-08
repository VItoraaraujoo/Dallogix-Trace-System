#!/usr/bin/env bash
set -u
source "$(cd "$(dirname "$0")" && pwd)/lib/csrf.sh"

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
base_url="$TRACE_BASE_URL"
cookie_file="$trace_test_tmp_dir/dallogix-trace-etapa11-cookie.txt"
test_number="ETAPA11-TEST-$(date +%s)"
temporary_csv="$trace_test_tmp_dir/dallogix-trace-etapa11-${test_number}.csv"
sed "s/ETAPA11-TEST-001/${test_number}/" testes/fixtures/import-etapa11.csv > "$temporary_csv"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi
csrf_header="$(trace_csrf_header "$login")" || exit 1

result="$(curl -sS -b "$cookie_file" -H "$csrf_header" -F "file=@${temporary_csv}" "$base_url/api/importar_csv.php")"
if ! printf '%s' "$result" | grep -q '"items":1'; then
  echo "FAIL: importação CSV falhou: $result"
  exit 1
fi

romaneios="$(curl -sS -G -b "$cookie_file" --data-urlencode "number=$test_number" "$base_url/api/romaneios.php")"
if ! printf '%s' "$romaneios" | grep -q "$test_number"; then
  echo "FAIL: romaneio importado não foi listado"
  exit 1
fi

echo "OK: CSV validado e persistido transacionalmente."
