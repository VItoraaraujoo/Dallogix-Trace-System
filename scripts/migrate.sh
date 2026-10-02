#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrations_dir="$root_dir/banco-de-dados/migrations"

mysql_query() {
  local sql="$1"
  bash "$root_dir/scripts/docker_compose.sh" --project-directory "$root_dir" exec -T mysql sh -lc \
    'export MYSQL_PWD="$MYSQL_PASSWORD"; mysql --batch --skip-column-names -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "$1"' \
    trace-migrate "$sql"
}

mysql_file() {
  bash "$root_dir/scripts/docker_compose.sh" --project-directory "$root_dir" exec -T mysql sh -lc \
    'export MYSQL_PWD="$MYSQL_PASSWORD"; mysql -u"$MYSQL_USER" "$MYSQL_DATABASE"' < "$1"
}

migration_lock="dallogix-trace-migrations"
lock_acquired="$(mysql_query "SELECT GET_LOCK('${migration_lock}', 30)" | tr -d '[:space:]')"
if [[ "$lock_acquired" != "1" ]]; then
  echo "ERRO: não foi possível obter a trava de migrations em 30 segundos." >&2
  exit 1
fi
trap 'mysql_query "SELECT RELEASE_LOCK('"'"'${migration_lock}'"'"')" >/dev/null 2>&1 || true' EXIT

mysql_query "CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(120) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)"

applied_count="$(mysql_query 'SELECT COUNT(*) FROM schema_migrations' | tr -d '[:space:]')"
has_trace_schema="$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'empresas'" | tr -d '[:space:]')"
if [[ "$has_trace_schema" == "1" ]]; then
  status_pc_table="$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'status_pc_industrial'" | tr -d '[:space:]')"
  if [[ "$status_pc_table" != "1" ]]; then
    status_pc_migration="$migrations_dir/051_status_pc_industrial.sql"
    [[ -f "$status_pc_migration" ]] || {
      echo "ERRO: migration 051_status_pc_industrial.sql não encontrada." >&2
      exit 1
    }
    echo "Reparando tabela status_pc_industrial antes das migrations"
    mysql_file "$status_pc_migration"
    mysql_query "INSERT IGNORE INTO schema_migrations (version) VALUES ('051_status_pc_industrial')"
  fi
fi
if [[ "$applied_count" == "0" && "$has_trace_schema" == "1" ]]; then
  # Instalações anteriores não tinham controle de versão. O schema atual já
  # contém as 23 migrations históricas; registra-as sem reaplicar ALTERs.
  for migration in "$migrations_dir"/[0-9][0-9][0-9]_*.sql; do
    version="$(basename "$migration" .sql)"
    [[ "$version" < "024_" ]] || continue
    mysql_query "INSERT IGNORE INTO schema_migrations (version) VALUES ('$version')"
  done
fi

for migration in "$migrations_dir"/[0-9][0-9][0-9]_*.sql; do
  version="$(basename "$migration" .sql)"
  if [[ "$(mysql_query "SELECT COUNT(*) FROM schema_migrations WHERE version = '$version'" | tr -d '[:space:]')" == "1" ]]; then
    continue
  fi
  echo "Aplicando migration $version"
  mysql_file "$migration"
  mysql_query "INSERT INTO schema_migrations (version) VALUES ('$version')"
done

# A tabela do heartbeat do PC industrial é necessária para o diagnóstico e
# pode estar ausente em instalações antigas mesmo quando a migration já foi
# registrada no controle de versão. Revalida a estrutura real para que um
# deploy consiga se autocorrigir sem depender de intervenção manual.
status_pc_table="$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'status_pc_industrial'" | tr -d '[:space:]')"
if [[ "$status_pc_table" != "1" ]]; then
  status_pc_migration="$migrations_dir/051_status_pc_industrial.sql"
  [[ -f "$status_pc_migration" ]] || {
    echo "ERRO: migration 051_status_pc_industrial.sql não encontrada." >&2
    exit 1
  }
  echo "Reparando tabela status_pc_industrial"
  mysql_file "$status_pc_migration"
  mysql_query "INSERT IGNORE INTO schema_migrations (version) VALUES ('051_status_pc_industrial')"
fi

echo "OK: migrations controladas e atualizadas."
