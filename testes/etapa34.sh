#!/usr/bin/env bash
set -u
source "$(cd "$(dirname "$0")" && pwd)/lib/csrf.sh"

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
base_url="$TRACE_BASE_URL"
cookie_file="$trace_test_tmp_dir/dallogix-trace-etapa34-cookie.txt"
temporary_csv="$trace_test_tmp_dir/dallogix-trace-etapa34-$(date +%s).csv"
number="CSV-$(date +%s)"
fail() { echo "FAIL: $1"; exit 1; }

sed "s/ETAPA34-TEST-001/$number/g" testes/fixtures/import-etapa34.csv > "$temporary_csv"
login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
printf '%s' "$login" | grep -q '"authenticated":true' || fail "login falhou"
csrf_header="$(trace_csrf_header "$login")" || fail "login sem CSRF"
result="$(curl -sS -b "$cookie_file" -H "$csrf_header" -F "file=@${temporary_csv}" "$base_url/api/importar_csv.php")"
printf '%s' "$result" | grep -q '"romaneios":1' || fail "romaneio não importado: $result"
printf '%s' "$result" | grep -q '"items":1' || fail "produto repetido não foi consolidado: $result"
printf '%s' "$result" | grep -q '"linhas":2' || fail "linhas importadas não informadas: $result"

echo "OK: CSV aceita data brasileira, motorista, expedidor e consolida produto repetido."
