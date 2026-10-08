#!/usr/bin/env bash
set -u

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
base_url="$TRACE_BASE_URL"
root="$(cd "$(dirname "$0")/.." && pwd)"
jar="$trace_test_tmp_dir/dx-etapa24-cookies.txt"
rm -f "$jar"
fail() { echo "FAIL: $1"; exit 1; }

# 1. Páginas de detalhe novas servidas com data-page correto.
check_page() {
  local file="$1" page="$2"
  local body="$trace_test_tmp_dir/dx-etapa24.html"
  trace_test_fetch_page "$file" "$page" "$body" || fail "$file não entrega a tela $page"
  grep -q 'class="sidebar"' "$body" || fail "$file sem menu lateral estático"
  grep -q 'id="screen-root"' "$body" || fail "$file sem área de conteúdo"
  grep -q 'data-action="logout"' "$body" || fail "$file sem botão sair"
  grep -Eq 'js/aplicacao.js\?v=[A-Za-z0-9._-]+' "$body" || fail "$file sem versionamento do app.js"
}
check_page manifest.html manifest
check_page manifest-edit.html manifest-edit
check_page dala.html dala
check_page dala-edit.html dala-edit

# 2. Credenciais nunca trafegam pela URL: formulário com POST e envio via fetch POST.
trace_test_fetch_page index.html login "$trace_test_tmp_dir/dx-etapa24-login.html" || fail "index.html não entrega a tela de login"
login_html="$(cat "$trace_test_tmp_dir/dx-etapa24-login.html")"
grep -q 'id="login-form"' <<< "$login_html" || fail "index.html sem formulário de login"
grep -Eq '<form id="login-form" method="post"' <<< "$login_html" || fail "formulário de login sem method=post"
login_js="$(curl -sS "$base_url/js/login.js")"
grep -q 'api.fetch("/api/login.php"' <<< "$login_js" || fail "login.js não envia credenciais para /api/login.php"
grep -q 'method: "POST"' <<< "$login_js" || fail "login.js não usa POST"
grep -q "replaceState" <<< "$login_js" || fail "login.js sem higiene de URL (replaceState)"
if grep -q 'password=' <<< "$login_js"; then fail "login.js monta query string com password"; fi
if grep -q 'password=' <<< "$login_html"; then fail "index.html contém password na URL/marcação"; fi

# 3. Autenticação e APIs da etapa respondem com JSON válido.
login_code="$(curl -sS -o $trace_test_tmp_dir/dx-etapa24-login.json -w '%{http_code}' -c "$jar" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
[ "$login_code" = "200" ] || fail "login admin retornou HTTP $login_code"
grep -q '"authenticated":true\|"authenticated": true' $trace_test_tmp_dir/dx-etapa24-login.json || fail "login não autenticou"
me_code="$(curl -sS -o /dev/null -w '%{http_code}' -b "$jar" "$base_url/api/me.php")"
[ "$me_code" = "200" ] || fail "sessão inválida após login (/api/me.php HTTP $me_code)"

for endpoint in romaneios.php monitoramento.php configuracoes.php dashboard.php produtos.php equipamentos.php; do
  body_code="$(curl -sS -o $trace_test_tmp_dir/dx-etapa24-api.json -w '%{http_code}' -b "$jar" "$base_url/api/$endpoint")"
  [ "$body_code" = "200" ] || fail "/api/$endpoint retornou HTTP $body_code"
done

# Filtros de romaneios aceitos pela API.
filtered_code="$(curl -sS -o $trace_test_tmp_dir/dx-etapa24-filter.json -w '%{http_code}' -b "$jar" "$base_url/api/romaneios.php?status=FINALIZADO&divergence=1")"
[ "$filtered_code" = "200" ] || fail "filtro de romaneios retornou HTTP $filtered_code"

# 4. Divergência sinalizada apenas para cargas finalizadas.
grep -q "FINALIZADO" "$root/servidor/api/romaneios/romaneios.php" || fail "romaneios.php sem regra de divergência para FINALIZADO"
if grep -q 'has_divergence' "$trace_test_tmp_dir/dx-etapa24-api.json" && ! grep -q 'has_divergence' "$trace_test_tmp_dir/dx-etapa24-filter.json"; then
  fail "campo has_divergence ausente na listagem filtrada"
fi

# 5. CSS cobre todos os componentes usados pelas telas.
css="$(curl -sS "$base_url/css/light-theme.css")$(curl -sS "$base_url/css/styles.css")"
for selector in '.grid.five' '.with-actions' '.detail-card' '.metric-blue' '.metric-orange' '.badge.orange' '.warning' '.required' '.placeholder-panel' '.csv-legacy' '.manifest-item' '.machine-grid' '.status-dot.online' '.status-dot.offline' '.dala-status'; do
  grep -q -- "$selector" <<< "$css" || fail "CSS sem estilo para $selector"
done

echo "OK: detalhes (romaneio/dala), login por POST sem credenciais na URL e componentes CSS completos."
