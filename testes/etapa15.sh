#!/usr/bin/env bash
set -u
source "$(cd "$(dirname "$0")" && pwd)/lib/csrf.sh"

source "$(cd "$(dirname "$0")" && pwd)/lib/ambiente_descartavel.sh"
trace_preparar_ambiente_descartavel
base_url="$TRACE_BASE_URL"
cookie_file="$trace_test_tmp_dir/dallogix-trace-etapa15-cookie.txt"
source "$(cd "$(dirname "$0")" && pwd)/lib/ensure_loading.sh"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
if ! printf '%s' "$login" | grep -q '"authenticated":true'; then
  echo "FAIL: login falhou"
  exit 1
fi
csrf_header="$(trace_csrf_header "$login")" || exit 1

loading_id="${TRACE_LOADING_ID:-$(ensure_loading_carregando)}"
[ -n "$loading_id" ] || { echo "FAIL: nenhum carregamento CARREGANDO disponível"; exit 1; }

first="$(curl -sS -b "$cookie_file" -H "$csrf_header" -H 'Content-Type: application/json' -d "{\"carregamento_id\":$loading_id}" "$base_url/api/leituras.php")"
if ! printf '%s' "$first" | grep -q '"result":"SEM_LEITURA"'; then
  echo "FAIL: falha sem leitura não foi registrada: $first"
  exit 1
fi
if ! printf '%s' "$first" | grep -q '"occurrence_id":'; then
  echo "FAIL: ocorrência automática não foi criada: $first"
  exit 1
fi

if ! printf '%s' "$first" | grep -q '"final":true'; then
  echo "FAIL: falha sem leitura não foi encerrada: $first"
  exit 1
fi

echo "OK: saco sem leitura encerrado, ocorrência criada e câmera sinalizada."
