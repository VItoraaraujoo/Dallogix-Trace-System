#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa4-cookie.txt"
number="TEST-$(date +%s)"

status() {
  curl -sS -o /dev/null -w '%{http_code}' "$@"
}

if [[ "$(status "$base_url/api/romaneios.php")" != "401" ]]; then
  echo "FAIL: romaneios sem sessão não está protegido"
  exit 1
fi

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login da etapa 4 falhou"
  exit 1
fi

if [[ "$(status -b "$cookie_file" "$base_url/api/produtos.php")" != "200" ]]; then
  echo "FAIL: listagem de produtos falhou"
  exit 1
fi

payload="{\"number\":\"${number}\",\"scheduled_date\":\"2026-08-20\",\"plate\":\"TST4$(date +%s | tail -c 5)\",\"product_code\":\"PROD3\",\"planned_quantity\":10}"
created="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "$payload" "$base_url/api/romaneios.php")"
if ! printf '%s' "$created" | grep -q '"status":"AGUARDANDO"'; then
  echo "FAIL: criação de romaneio falhou: $created"
  exit 1
fi

if [[ "$(status -b "$cookie_file" -H 'Content-Type: application/json' -d "$payload" "$base_url/api/romaneios.php")" != "409" ]]; then
  echo "FAIL: romaneio duplicado foi aceito"
  exit 1
fi

if [[ "$(status -b "$cookie_file" "$base_url/api/romaneios.php")" != "200" ]]; then
  echo "FAIL: listagem de romaneios falhou"
  exit 1
fi

echo "OK: sessão, produtos, criação/listagem de romaneio e duplicidade validados."
