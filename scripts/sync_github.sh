#!/usr/bin/env bash
set -euo pipefail

# Sincroniza uma instalação do servidor somente por fast-forward.
# Não sobrescreve alterações locais, .env, armazenamento ou dados do Compose.
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
if [[ ! -f "$root_dir/docker-compose.yml" ]]; then
  # Kits de homologacao guardam uma copia deste sincronizador em
  # armazenamento/updates/master-homologacao, fora da arvore Git antiga.
  root_dir="$(cd "$(dirname "$0")/../../.." && pwd)"
fi
[[ -f "$root_dir/docker-compose.yml" ]] || {
  echo "Raiz da instalacao nao encontrada para sincronizacao." >&2
  exit 2
}
remote_name="${TRACE_GITHUB_REMOTE:-origin}"
branch="${TRACE_GITHUB_BRANCH:-master}"
dry_run="${TRACE_GITHUB_DRY_RUN:-0}"
block_active="${TRACE_GITHUB_BLOCK_ACTIVE:-1}"

cd "$root_dir"
[[ -d .git ]] || { echo "Repositório Git não encontrado: $root_dir" >&2; exit 2; }
git remote get-url "$remote_name" >/dev/null || { echo "Remote GitHub não configurado: $remote_name" >&2; exit 3; }
[[ -z "$(git status --porcelain --untracked-files=all -- . ':!.env' ':!armazenamento/' ':!tmp/' ':!**/__pycache__/')" ]] || {
  echo "Sincronização interrompida: existem alterações locais fora de .env/armazenamento/tmp/cache." >&2
  exit 4
}

# Clones de uma unica branch podem ter um refspec que nao inclui master.
# Atualize explicitamente a referencia consultada abaixo, alem de FETCH_HEAD.
git fetch --prune "$remote_name" "+refs/heads/$branch:refs/remotes/$remote_name/$branch"
local_commit="$(git rev-parse HEAD)"
branch_commit="$(git rev-parse "$remote_name/$branch")"
remote_commit="$branch_commit"
if [[ -n "${TRACE_GITHUB_TARGET_COMMIT:-}" ]]; then
  [[ "${TRACE_GITHUB_TARGET_COMMIT}" =~ ^[0-9a-fA-F]{40}$ ]] || {
    echo "TRACE_GITHUB_TARGET_COMMIT invalido." >&2
    exit 5
  }
  remote_commit="$(git rev-parse "${TRACE_GITHUB_TARGET_COMMIT}^{commit}")" || {
    echo "O commit informado pelo servidor nao foi encontrado no GitHub." >&2
    exit 5
  }
  git merge-base --is-ancestor "$remote_commit" "$branch_commit" || {
    echo "O commit informado pelo servidor nao pertence a $remote_name/$branch." >&2
    exit 5
  }
fi
if [[ "$local_commit" == "$remote_commit" ]]; then
  echo "Instalacao ja esta no commit $local_commit de $remote_name/$branch."
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

if [[ "$block_active" == "1" ]]; then
  active="$(docker compose exec -T mysql sh -lc 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -N -B -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "SELECT COUNT(*) FROM carregamentos WHERE state IN ('\''PREPARANDO'\'', '\''CARREGANDO'\'', '\''PAUSADO'\'', '\''FINALIZANDO'\'', '\''EMERGENCIA'\'');"' 2>/dev/null | tr -d '[:space:]')" || {
    echo "Sincronização interrompida: não foi possível verificar carregamentos ativos." >&2
    exit 7
  }
  [[ "$active" =~ ^[0-9]+$ ]] || {
    echo "Sincronização interrompida: resposta inválida ao verificar carregamentos ativos." >&2
    exit 8
  }
  if [[ "$active" != "0" ]]; then
    echo "Sincronização adiada: existe carregamento ativo ou em estado de intervenção." >&2
    exit 9
  fi
fi

# Migrações versionadas: mantém os dados, cria backup antes de qualquer DDL e
# usa schema_migrations como fonte única de verdade.
mkdir -p armazenamento/backups
if [[ "${TRACE_PREMERGE_BACKUP_DONE:-0}" != "1" ]]; then
  bash scripts/backup_db.sh
fi
git merge --ff-only "$remote_commit"
bash scripts/migrate.sh
# Reconstrói e recria somente os serviços afetados pela alteração. A VM, o
# banco e os serviços que não mudaram permanecem em execução.
bash "$root_dir/scripts/docker_compose.sh" up -d --build --remove-orphans
healthy=0
health_path="${TRACE_GITHUB_HEALTH_PATH:-/api/prontidao.php}"
case "$health_path" in
  /api/prontidao.php|/api/health.php) ;;
  *) echo "TRACE_GITHUB_HEALTH_PATH invalido." >&2; exit 6 ;;
esac
web_port="${WEB_PORT:-}"
if [[ -z "$web_port" && -f "$root_dir/.env" ]]; then
  web_port="$(sed -n 's/^WEB_PORT=//p' "$root_dir/.env" | tail -1 | tr -d '"')"
fi
web_port="${web_port:-8080}"
for _ in $(seq 1 "${HEALTHCHECK_ATTEMPTS:-90}"); do
  if curl --fail --silent --max-time 3 "http://127.0.0.1:${web_port}${health_path}" >/dev/null; then healthy=1; break; fi
  sleep 2
done
[[ "$healthy" == "1" ]] || { echo "Atualização aplicada, mas o healthcheck falhou." >&2; exit 6; }
echo "Instalacao sincronizada com $remote_commit de $remote_name/$branch."
