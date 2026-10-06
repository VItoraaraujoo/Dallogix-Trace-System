#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root_dir"
git_command="${TRACE_SECURITY_SCAN_GIT:-git}"

scan_git_pattern() {
  local label="$1"
  local pattern="$2"
  shift 2
  local output
  local status

  # git grep retorna 1 quando não encontra nada e códigos diferentes quando
  # não consegue executar a consulta. O primeiro é o resultado esperado; o
  # segundo precisa interromper o pipeline para não mascarar uma falha do
  # próprio scanner.
  if output="$("$git_command" grep -nI -E "$pattern" -- "$@" 2>&1)"; then
    printf '%s\n' "$output" >&2
    return 0
  else
    status=$?
  fi
  if [[ "$status" == "1" ]]; then
    return 1
  fi
  printf 'Falha ao executar a varredura de %s (git grep status %s):\n%s\n' \
    "$label" "$status" "$output" >&2
  return 2
}

# Falha somente para credenciais com formato inequívoco. Valores de exemplo
# documentados (change-me-*) não são tratados como segredos reais.
status=0
scan_git_pattern "chaves privadas" \
  'BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}' \
  . ':!documentacao' ':!README.md' || status=$?
if [[ "$status" == "0" ]]; then
  echo "Falha: possível credencial privada encontrada no código rastreado." >&2
  exit 1
elif [[ "$status" != "1" ]]; then
  exit "$status"
fi

status=0
scan_git_pattern "segredos fixos" \
  "(^|[^A-Za-z])(password|passwd|secret|token)[[:space:]]*=[[:space:]]*[\"'][^\$\"']{12,}[\"']" \
  '*.php' '*.js' '*.sh' '*.yml' '*.yaml' '*.json' ':!testes' || status=$?
if [[ "$status" == "0" ]]; then
  echo "Falha: possível segredo fixo encontrado no código rastreado." >&2
  exit 1
elif [[ "$status" != "1" ]]; then
  exit "$status"
fi

echo "OK: nenhuma credencial privada ou segredo fixo de alto risco encontrado."
