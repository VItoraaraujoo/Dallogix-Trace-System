#!/usr/bin/env bash
set -u

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
base_url="$TRACE_BASE_URL"
root="$(cd "$(dirname "$0")/.." && pwd)"
fail() { echo "FAIL: $1"; exit 1; }

trace_test_fetch_page emergency.html emergency "$trace_test_tmp_dir/dx-etapa27-emergency.html" || fail "emergency.html não entrega a tela de emergência"
app_js="$(curl -sS "$base_url/js/aplicacao.js")"
grep -q 'emergency: () => \[store.loadActiveLoading()' <<< "$app_js" || fail "emergency sem carregamento ativo"
view_js="$(curl -sS "$base_url/js/funcoes/view.js")"
grep -q 'Liberar emergência' <<< "$view_js" || fail "tela de emergência sem botão de liberação"
grep -q 'não confirma o estado físico da esteira' <<< "$view_js" || fail "retorno aplicado não distingue confirmação física"
store_js="$(curl -sS "$base_url/js/classes/ArmazenamentoTrace.js")"
grep -q '/api/desbloquear_maquina.php' <<< "$store_js" || fail "liberação não chama a API de desbloqueio"
grep -q 'await this.loadActiveLoading();' <<< "$store_js" || fail "estado não é recarregado após desbloqueio"
unlock_api="$root/servidor/api/operacoes/desbloquear_maquina.php"
grep -q 'a máquina só será liberada após confirmação do gateway industrial' "$unlock_api" || fail "API não mantém o intertravamento até a confirmação do gateway"

echo "OK: tela de emergência agora exibe a liberação e atualiza o estado do carregamento."
