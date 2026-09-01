#!/usr/bin/env bash
set -euo pipefail

# Sincroniza uma instalação do servidor somente por fast-forward.
# Não sobrescreve alterações locais, .env, armazenamento ou dados do Compose.
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
remote_name="${TRACE_GITHUB_REMOTE:-empresa}"
branch="${TRACE_GITHUB_BRANCH:-master}"
dry_run="${TRACE_GITHUB_DRY_RUN:-0}"

cd "$root_dir"
[[ -d .git ]] || { echo "Repositório Git não encontrado: $root_dir" >&2; exit 2; }
git remote get-url "$remote_name" >/dev/null || { echo "Remote GitHub não configurado: $remote_name" >&2; exit 3; }
[[ -z "$(git status --porcelain --untracked-files=all -- . ':!.env' ':!armazenamento/' ':!tmp/')" ]] || {
  echo "Sincronização interrompida: existem alterações locais fora de .env/armazenamento/tmp." >&2
  exit 4
}

git fetch --prune "$remote_name" "$branch"
local_commit="$(git rev-parse HEAD)"
remote_commit="$(git rev-parse "$remote_name/$branch")"
if [[ "$local_commit" == "$remote_commit" ]]; then
  echo "Servidor já está sincronizado com $remote_name/$branch ($local_commit)."
  exit 0
fi
git merge-base --is-ancestor "$local_commit" "$remote_commit" || {
  echo "Sincronização interrompida: atualização não é fast-forward." >&2
  exit 5
}
if [[ "$dry_run" == "1" ]]; then
  echo "Simulação: servidor avançaria de $local_commit para $remote_commit."
  exit 0
fi

git merge --ff-only "$remote_name/$branch"
# O Nginx resolve o nome do PHP ao iniciar. Recriar todos os serviços evita que
# ele conserve o IP antigo quando o container PHP for reconstruído.
docker compose up -d --build --force-recreate
healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent --max-time 3 "http://127.0.0.1:${PHP_PORT:-8080}/api/health.php" >/dev/null; then healthy=1; break; fi
  sleep 2
done
[[ "$healthy" == "1" ]] || { echo "Atualização aplicada, mas o healthcheck falhou." >&2; exit 6; }
echo "Servidor sincronizado com $remote_name/$branch em $remote_commit."
