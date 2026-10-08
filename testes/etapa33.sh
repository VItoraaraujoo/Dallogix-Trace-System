#!/usr/bin/env bash
set -u

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
trace_exigir_compose_producao_teste

root="$(cd "$(dirname "$0")/.." && pwd)"
fail() { echo "FAIL: $1"; exit 1; }

roles="$(trace_test_mysql_query app "SHOW COLUMNS FROM usuarios LIKE 'role'" 2>/dev/null)"
grep -q "'ADMIN_DALLOGIX','ADMIN_EMPRESA','SUPERVISOR','USUARIO'" <<< "$roles" || fail "enum de perfis não foi consolidado"
grep -q 'OPERADOR\|MANUTENCAO' <<< "$roles" && fail "perfil antigo ainda está presente no banco"
grep -q 'USUARIO: \[' "$root/interface/js/configuracaoAplicacao.js" || fail "navegação do usuário não configurada"
grep -q 'require_role(\["ADMIN_EMPRESA", "SUPERVISOR", "USUARIO"\])' "$root/servidor/api/operacoes/desbloquear_maquina.php" || fail "desbloqueio não está restrito aos perfis operacionais autorizados"

echo "OK: quatro perfis oficiais e permissões críticas consolidados."
