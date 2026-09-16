#!/usr/bin/env bash
set -euo pipefail

# Mantém a instalação local alinhada à master do repositório configurado.
# Alterações manuais e operações ativas fazem a sincronização ser adiada.
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
log_dir="$root_dir/armazenamento/logs"
mkdir -p "$log_dir"
exec >> "$log_dir/sync-master.log" 2>&1

cd "$root_dir"
current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "master" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Atualização adiada: branch local é '$current_branch'; esperado 'master'."
  exit 0
fi

export TRACE_GITHUB_REMOTE="origin"
export TRACE_GITHUB_BRANCH="master"
export TRACE_GITHUB_BLOCK_ACTIVE="1"
exec bash "$root_dir/scripts/sync_github.sh"
