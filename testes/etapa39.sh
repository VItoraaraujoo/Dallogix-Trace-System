#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
master_cookie="/tmp/dallogix-trace-etapa39-master-cookie.txt"
user_cookie="/tmp/dallogix-trace-etapa39-user-cookie.txt"
fail() { echo "FAIL: $1"; exit 1; }

login="$(curl -sS -c "$master_cookie" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
printf '%s' "$login" | grep -q '"authenticated":true' || fail "login Master falhou"

company_id="$(printf '%s' "$login" | sed -n 's/.*"company_id":\([0-9][0-9]*\).*/\1/p')"
company_domain="$(printf '%s' "$login" | sed -n 's/.*"company_login_domain":"\([^"]*\)".*/\1/p')"
[ -n "$company_id" ] || fail "nenhuma empresa de teste encontrada"
[ -n "$company_domain" ] || fail "domínio da empresa de teste não encontrado"
stamp="$(date +%s)"
email_prefix="revoga${stamp}"
created="$(curl -sS -b "$master_cookie" -H 'Content-Type: application/json' -d "{\"company_id\":${company_id},\"name\":\"Teste revogação ${stamp}\",\"email_prefix\":\"${email_prefix}\",\"password\":\"senha-inicial-39\",\"role\":\"SUPERVISOR\"}" "$base_url/api/usuarios.php")"
user_id="$(printf '%s' "$created" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
[ -n "$user_id" ] || fail "usuário de teste não foi criado: $created"

user_email="${email_prefix}@${company_domain}"
user_login="$(curl -sS -c "$user_cookie" -H 'Content-Type: application/json' -d "{\"email\":\"${user_email}\",\"password\":\"senha-inicial-39\"}" "$base_url/api/login.php")"
printf '%s' "$user_login" | grep -q '"authenticated":true' || fail "login do usuário de teste falhou: $user_login"

updated="$(curl -sS -b "$master_cookie" -X PUT -H 'Content-Type: application/json' -d "{\"id\":${user_id},\"company_id\":${company_id},\"name\":\"Teste revogação atualizado\",\"role\":\"SUPERVISOR\",\"active\":true,\"password\":\"senha-nova-39\"}" "$base_url/api/usuarios.php")"
printf '%s' "$updated" | grep -q '"updated":true' || fail "alteração de senha não foi aceita: $updated"

me_status="$(curl -sS -o /tmp/dallogix-trace-etapa39-me.json -w '%{http_code}' -b "$user_cookie" "$base_url/api/me.php")"
[ "$me_status" = "401" ] || fail "sessão antiga continuou válida após alteração de senha (HTTP $me_status)"

echo "OK: alteração de credencial invalidou a sessão anterior imediatamente."
