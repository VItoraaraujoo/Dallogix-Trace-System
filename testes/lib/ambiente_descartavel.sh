#!/usr/bin/env bash

trace_preparar_ambiente_descartavel() {
  local base_url="${TRACE_BASE_URL:-}"
  if [[ -z "$base_url" ]]; then
    echo "FAIL: defina TRACE_BASE_URL para a fixture descartável." >&2
    exit 2
  fi
  if [[ "${TRACE_REGRESSION_DISPOSABLE:-0}" != "1" ]]; then
    echo "FAIL: confirme a fixture descartável com TRACE_REGRESSION_DISPOSABLE=1." >&2
    exit 2
  fi

  base_url="${base_url%/}"
  if [[ ! "$base_url" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]]; then
    echo "FAIL: testes integrados só podem apontar para uma URL loopback." >&2
    exit 2
  fi

  TRACE_BASE_URL="$base_url"
  export TRACE_BASE_URL
  umask 077
  trace_test_tmp_dir="$(mktemp -d /tmp/dallogix-trace-test.XXXXXX)" || {
    echo "FAIL: não foi possível criar a pasta temporária privada do teste." >&2
    exit 1
  }

  trace_limpar_ambiente_descartavel() {
    local original_status="${1:-0}"
    local cleanup_status=0
    trap - EXIT
    if [[ -n "${trace_test_tmp_dir:-}" && -d "$trace_test_tmp_dir" ]]; then
      rm -rf -- "$trace_test_tmp_dir" || cleanup_status=$?
    fi
    if [[ "$original_status" -ne 0 ]]; then
      return "$original_status"
    fi
    return "$cleanup_status"
  }
  trap 'trace_limpar_ambiente_descartavel "$?"' EXIT
}

trace_exigir_compose_producao_teste() {
  if [[ "${COMPOSE_FILE:-}" != *docker-compose.production-test.yml* || -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
    echo "FAIL: configure COMPOSE_FILE=docker-compose.production-test.yml e um COMPOSE_PROJECT_NAME isolado." >&2
    exit 2
  fi
}

trace_test_mysql_query() {
  local account="$1"
  local query="$2"
  case "$account" in
    root|app) ;;
    *) echo "FAIL: conta MySQL de teste inválida." >&2; return 2 ;;
  esac
  docker compose exec -T mysql sh -lc '
    set -eu
    if [ "$1" = root ]; then
      MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -N -B --default-character-set=utf8mb4 -u root "$MYSQL_DATABASE" -e "$2"
    else
      MYSQL_PWD="$MYSQL_PASSWORD" mysql -N -B --default-character-set=utf8mb4 -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "$2"
    fi
  ' trace-test "$account" "$query"
}

trace_test_fetch_page() {
  local legacy_path="$1"
  local expected_page="$2"
  local output_file="$3"
  local alias_file="$trace_test_tmp_dir/trace-page-alias.html"
  local code target

  code="$(curl -sS -o "$alias_file" -w '%{http_code}' "$TRACE_BASE_URL/$legacy_path")" || return 1
  [[ "$code" == "200" ]] || {
    echo "$legacy_path retornou HTTP $code" >&2
    return 1
  }

  if grep -Eq "<script[^>]*data-page=\"$expected_page\"" "$alias_file"; then
    cp "$alias_file" "$output_file"
    trace_test_page_path="/$legacy_path"
    return 0
  fi

  target="$(sed -n 's/.*data-target="\([^\"]*\)".*/\1/p' "$alias_file" | head -n 1)"
  [[ "$target" =~ ^/telas/[A-Za-z0-9/_-]+\.html$ ]] || {
    echo "$legacy_path não é uma tela nem contém destino de redirecionamento válido" >&2
    return 1
  }
  grep -Eq 'js/redirecionar-tela\.js\?v=[A-Za-z0-9._-]+' "$alias_file" || {
    echo "$legacy_path não carrega o redirecionador versionado" >&2
    return 1
  }

  code="$(curl -sS -o "$output_file" -w '%{http_code}' "$TRACE_BASE_URL$target")" || return 1
  [[ "$code" == "200" ]] || {
    echo "$target retornou HTTP $code" >&2
    return 1
  }
  grep -Eq "<script[^>]*data-page=\"$expected_page\"" "$output_file" || {
    echo "$legacy_path redireciona para tela sem data-page=\"$expected_page\"" >&2
    return 1
  }
  trace_test_page_path="$target"
}
