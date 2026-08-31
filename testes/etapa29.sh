#!/usr/bin/env bash
set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
fail() { echo "FAIL: $1"; exit 1; }

grep -q 'company_settings' "$root/servidor/api/sync_queue.php" || fail "retry não usa URL salva nas configurações"
grep -q 'tabletTimer' "$root/interface/js/aplicacao.js" || fail "tablet sem atualização automática"
grep -q 'ultima_leitura' "$root/interface/js/telas/monitoramento.js" || fail "tablet sem última leitura"
grep -q 'animation: none' "$root/interface/css/light-theme.css" || fail "animações não removidas"
grep -q 'gap: 24px' "$root/interface/css/light-theme.css" || fail "espaçamento do dashboard não corrigido"
for file in "$root"/interface/*.html; do grep -q 'js/aplicacao.js?v=' "$file" || fail "cache do app não versionado em $file"; done

php -l "$root/servidor/api/sync_queue.php" >/dev/null || fail "sync_queue.php inválido"
php -l "$root/servidor/api/sync_status.php" >/dev/null || fail "sync_status.php inválido"
node --input-type=module --check < "$root/interface/js/aplicacao.js" >/dev/null || fail "app.js inválido"
node --check "$root/interface/js/telas/monitoramento.js" >/dev/null || fail "monitoring.js inválido"
echo "OK: retry, tablet, desbloqueio, configurações, animações, cache e espaçamento validados."
