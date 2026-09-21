#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
master_cookie="/tmp/dallogix-trace-etapa37-master.txt"
company_cookie="/tmp/dallogix-trace-etapa37-company.txt"
fail() { echo "FAIL: $1"; exit 1; }

master="$(curl -sS -c "$master_cookie" -H 'Content-Type: application/json' -d '{"email":"master@dallogix.local","password":"password"}' "$base_url/api/login.php")"
printf '%s' "$master" | grep -q '"authenticated":true' || fail "login Master falhou"
curl -sS -b "$master_cookie" "$base_url/api/licencas.php" | grep -q '"billing_period":"MENSAL"' || fail "licenças mensais não foram listadas"

blocked="$(curl -sS -X PUT -b "$master_cookie" -H 'Content-Type: application/json' -d '{"company_id":1,"status":"BLOQUEADA","due_at":"2099-12-31","blocked_reason":"Teste automatizado"}' "$base_url/api/licencas.php")"
printf '%s' "$blocked" | grep -q '"status":"BLOQUEADA"' || fail "bloqueio da empresa não foi salvo: $blocked"

blocked_login="$(curl -sS -o /tmp/dallogix-trace-etapa37-blocked-login.json -w '%{http_code}' -c "$company_cookie" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
[ "$blocked_login" = "402" ] || fail "licença bloqueada ainda permitiu login: HTTP $blocked_login"
grep -q '"error_code":"LICENSE_INACTIVE"' /tmp/dallogix-trace-etapa37-blocked-login.json || fail "login bloqueado não informou licença inativa"

active="$(curl -sS -X PUT -b "$master_cookie" -H 'Content-Type: application/json' -d '{"company_id":1,"status":"ATIVA","due_at":"2099-12-31","blocked_reason":""}' "$base_url/api/licencas.php")"
printf '%s' "$active" | grep -q '"status":"ATIVA"' || fail "reativação da licença falhou: $active"
login="$(curl -sS -c "$company_cookie" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
printf '%s' "$login" | grep -q '"authenticated":true' || fail "login da empresa não voltou após reativação"
echo "OK: licença mensal, bloqueio Master, bloqueio de login e reativação validados."
