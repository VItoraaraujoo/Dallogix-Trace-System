#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root_dir"

while IFS= read -r php_file; do
  php -l "$php_file" >/dev/null
done < <(find servidor scripts -type f -name '*.php' | sort)

while IFS= read -r js_file; do
  # O front-end usa módulos ES. Validar pela entrada padrão evita que versões
  # antigas do Node tratem arquivos .js como CommonJS apenas por não haver package.json.
  node --input-type=module --check < "$js_file" >/dev/null
done < <(find interface/js -type f -name '*.js' | sort)

node scripts/check_frontend_modules.mjs
node --test testes/ambiente-descartavel.mjs

while IFS= read -r shell_file; do
  bash -n "$shell_file"
done < <(find scripts testes -type f -name '*.sh' | sort)

while IFS= read -r json_file; do
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$json_file"
done < <(find integracoes -type f -name '*.json' | sort)

while IFS= read -r js_file; do
  cache_path="/${js_file#interface/}"
  if ! grep -Fq "\"$cache_path\"" interface/service-worker.js; then
    echo "FAIL: módulo JavaScript fora do precache: $cache_path" >&2
    exit 1
  fi
done < <(find interface/js -type f -name '*.js' | sort)

if grep -Rqs 'TraceRouter' interface/js; then
  echo 'FAIL: referência residual ao TraceRouter removido.' >&2
  exit 1
fi

if grep -Eq '\$user\[' servidor/api/sistema/configuracoes.php; then
  echo 'FAIL: configuracoes.php usa $user sem inicialização; use $usuarioAtor.' >&2
  exit 1
fi

python3 -m py_compile scripts/test_modbus_virtual.py integracoes/modbus-virtual/server.py testes/modbus-transporte.py
bash testes/sync-github-fetch.sh
node --test testes/atualizador-permissoes.mjs
node --test testes/atualizador-linux.mjs
node --test testes/verificacao-producao.mjs testes/html-seguro.mjs
node --test testes/cliente-api.mjs testes/operacoes-offline.mjs testes/servico-emergencia.mjs testes/servico-operacao.mjs testes/servico-sincronizacao.mjs testes/componentes-estados.mjs testes/status-servidor.mjs testes/cache-versao.mjs testes/romaneio-criacao.mjs testes/acoes-cadastros.mjs testes/acoes-relatorios.mjs testes/despachante-acoes.mjs testes/paginacao-api.mjs testes/status-configuracoes.mjs testes/status-dalas.mjs testes/status-empresas.mjs testes/comandos-maquina.mjs testes/alertas.mjs testes/atualizador-windows.mjs testes/validadores.mjs testes/armazenamento-permissoes.mjs
node --test testes/armazenamento-resposta.mjs
node --test testes/armazenamento-servicos-sob-demanda.mjs
node --test testes/acoes-administracao.mjs
node --test testes/acoes-operacionais.mjs
node --test testes/servico-instalacoes-industriais.mjs
node --test testes/servico-administracao-contas.mjs
node --test testes/servico-romaneios.mjs
node --test testes/servico-acoes-dala.mjs
node --test testes/servico-carregamento-ativo.mjs
node --test testes/formulario-login.mjs
node --test testes/comandos-concorrencia.mjs
node --test testes/operacao-comandos-ui.mjs
node --test testes/carregador-paginas-performance.mjs testes/registro-telas.mjs testes/resumo-final-performance.mjs testes/servico-observabilidade.mjs
node --test testes/ocorrencias-performance.mjs
node --test testes/notificacoes.mjs
node --test testes/healthchecks-workers.mjs
node --test testes/keyence-worker.mjs
node --test testes/mysql-recursos.mjs
node --test testes/dialogo-acessibilidade.mjs
node --test testes/log-frontend.mjs
node --test testes/revisao-integridade-limites.mjs
node --test testes/tempo-real.mjs
node --test testes/security-scan.mjs
node --test testes/auditoria-controle-acesso.mjs
node --test testes/gateway-clp.mjs testes/node-red-flow-sync.mjs testes/node-red-modbus-tcp.mjs testes/node-red-healthcheck.mjs
bash -n scripts/check_production_env.sh
bash -n scripts/check_physical_deployment.sh scripts/launch_kiosk.sh
sh -n integracoes/node-red/entrypoint.sh
grep -q 'entrypoint: \["/bin/sh", "/seed/entrypoint.sh"\]' docker-compose.yml
php_compose_block="$(awk '/^  php:/{in_php=1} in_php{print} in_php && /^  [a-z0-9_-]+:/{if ($0 !~ /^  php:/) exit}' docker-compose.yml)"
grep -q 'armazenamento-init:' <<<"$php_compose_block"
grep -q 'condition: service_completed_successfully' <<<"$php_compose_block"
grep -q 'paradaAposInicio' servidor/src/Aplicacao/ServicoComandoClp.php

echo 'OK: sintaxe PHP/JavaScript e referências órfãs verificadas.'
