#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa21-cookie.txt"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then echo "FAIL: login falhou"; exit 1; fi
csrf_token="$(printf '%s' "$login" | sed -n 's/.*"csrf_token":"\([^"]*\)".*/\1/p')"

config="$(curl -sS -b "$cookie_file" "$base_url/api/configuracoes.php")"
if ! printf '%s' "$config" | grep -q '"dalas"'; then echo "FAIL: configuração não retornou dalas: $config"; exit 1; fi

blocked="$(curl -sS -b "$cookie_file" -X PUT -H 'Content-Type: application/json' -H "X-CSRF-Token: ${csrf_token}" -d '{"gateway_public_ip":"192.0.2.10","sync_remote_url":"https://api.example.test/events","pdf_field_mapping":{"produto":"REFERENCIA","quantidade":"QTD"}}' "$base_url/api/configuracoes.php")"
if ! printf '%s' "$blocked" | grep -q 'servidor é configurada somente no backend'; then echo "FAIL: configuração do endpoint remoto não foi protegida: $blocked"; exit 1; fi

saved="$(curl -sS -b "$cookie_file" -X PUT -H 'Content-Type: application/json' -H "X-CSRF-Token: ${csrf_token}" -d '{"gateway_public_ip":"192.0.2.10","pdf_field_mapping":{"produto":"REFERENCIA","quantidade":"QTD"}}' "$base_url/api/configuracoes.php")"
if ! printf '%s' "$saved" | grep -q '"saved":true'; then echo "FAIL: configuração não foi salva: $saved"; exit 1; fi

echo "OK: configuração de gateway, API cloud e mapeamento PDF disponível."
