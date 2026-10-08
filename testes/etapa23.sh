#!/usr/bin/env bash
set -u

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
base_url="$TRACE_BASE_URL"
fail() { echo "FAIL: $1"; exit 1; }

# Rotas antigas redirecionam para os HTMLs separados que mantêm data-page.
check_page() {
  local file="$1" page="$2"
  local body="$trace_test_tmp_dir/dx-etapa23.html"
  trace_test_fetch_page "$file" "$page" "$body" || fail "$file não entrega a tela $page"
  if [ "$page" != "login" ]; then
    grep -q 'class="sidebar"' "$body" || fail "$file sem menu lateral estático"
    grep -q 'class="topbar"' "$body" || fail "$file sem barra superior estática"
    grep -q 'id="screen-root"' "$body" || fail "$file sem área de conteúdo"
    grep -q 'data-action="toggle-menu"' "$body" || fail "$file sem botão de recolher menu"
    grep -q 'data-action="logout"' "$body" || fail "$file sem botão sair"
  else
    grep -q 'id="login-form"' "$body" || fail "$file sem formulário de login estático"
  fi
  if [ "$page" = "login" ]; then
    grep -Eq 'js/login\.js\?v=[A-Za-z0-9._-]+' "$body" || fail "$file sem versionamento do login.js"
  else
    grep -Eq 'js/aplicacao\.js\?v=[A-Za-z0-9._-]+' "$body" || fail "$file sem versionamento do app.js"
  fi
}

check_page index.html login
check_page dashboard.html dashboard
check_page manifests.html manifests
check_page import.html import
check_page division.html division
check_page work.html work
check_page occurrences.html occurrences
check_page summary.html summary
check_page products.html products
check_page alerts.html alerts
check_page emergency.html emergency
check_page settings.html settings
check_page dalas.html dalas
check_page companies.html companies
check_page company.html company

core="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/js/aplicacao.js")"
[ "$core" = "200" ] || fail "js/aplicacao.js não disponível (HTTP $core)"
core_js="$(curl -sS "$base_url/js/aplicacao.js")"
if grep -q '?page=' <<< "$core_js"; then
  fail "js/aplicacao.js ainda contém navegação ?page="
fi

# As exports consumidas pelas telas precisam existir em view.js/html.js.
view_js="$(curl -sS "$base_url/js/funcoes/view.js")"
for fn in pageHeader statuses progress badge manifestsTable deviceBadge machineGrid companyGrid; do
  grep -q "export function $fn" <<< "$view_js" || fail "view.js sem export: $fn"
done
html_js="$(curl -sS "$base_url/js/funcoes/html.js")"
for fn in el esc button; do
  grep -q "export const $fn" <<< "$html_js" || fail "html.js sem export: $fn"
done

# HTML/JS/CSS devem ser sempre revalidados pelo navegador.
cache_header="$(curl -sSI "$base_url/manifests.html" | grep -i 'cache-control' | head -1)"
printf '%s' "$cache_header" | grep -qi 'no-cache' || fail "Cache-Control ausente no HTML: $cache_header"

echo "OK: telas HTML locais servidas com data-page correto e núcleo único em js/aplicacao.js."
