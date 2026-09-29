# Burp Suite em homologação local

O overlay `docker-compose.burp-test.yml` adiciona um HAProxy TCP opcional à
homologação de produção. Ele publica somente em `127.0.0.1:18443` e encaminha
TLS sem descriptografar para o Nginx de homologação. O certificado e a
terminação TLS continuam no Nginx.

## Preparar o ambiente isolado

Use um projeto, banco, diretório de estado, arquivo de ambiente e porta próprios
para que o teste não se conecte aos containers industriais nem à homologação
de outra sessão:

```bash
export TRACE_PRODUCTION_TEST_PROJECT=trace-burp-test
export TRACE_PRODUCTION_TEST_STATE_DIR="$PWD/tmp/trace-burp-test/state"
export TRACE_PRODUCTION_TEST_ENV_FILE="$PWD/tmp/trace-burp-test/.env"
export TRACE_TEST_STORAGE_PATH="$PWD/tmp/trace-burp-test/storage"
export TRACE_TEST_HTTPS_PORT=18444
export TRACE_BURP_PORT=18443

python3 scripts/production_test.py

docker compose \
  --project-name "$TRACE_PRODUCTION_TEST_PROJECT" \
  --env-file "$TRACE_PRODUCTION_TEST_ENV_FILE" \
  -f docker-compose.production-test.yml \
  -f docker-compose.burp-test.yml \
  --profile burp up -d --wait haproxy
```

O setup cria credenciais aleatórias de teste em
`tmp/trace-burp-test/state/acessos.json`. Esse arquivo contém segredos: não o
envie nem o adicione ao Git. O Nginx direto fica em `https://localhost:18444`;
para o teste via HAProxy, use `https://localhost:18443`.

## Configurar o escopo no Burp

Abra **Proxy > Intercept > Open browser** e navegue para
`https://localhost:18443/`. Em **Target > Scope**, adicione o prefixo
`https://localhost:18443/`. A lista pronta está em
[`burp/scope-prefixes.txt`](../../burp/scope-prefixes.txt). Ative o filtro para
mostrar somente itens dentro do escopo.

Na edição Community, recrie esse escopo ao abrir uma nova sessão; a edição
Professional pode guardá-lo no projeto em disco. Consulte a documentação oficial
do [escopo](https://portswigger.net/burp/documentation/desktop/getting-started/setting-target-scope)
e do [navegador integrado do Burp](https://portswigger.net/burp/documentation/desktop/tools/burps-browser).

Comece com navegação manual, histórico e análise passiva. Faça requisições de
alteração apenas contra esse banco descartável e com as credenciais geradas
para ele. Não adicione o domínio público, o servidor central, endereços de CLP,
Modbus, Node-RED ou máquinas físicas ao escopo. O overlay não abre portas para
a rede local ou para a internet.

O certificado TLS usado pelo ambiente é local e autossinado. O navegador do
Burp já confia no certificado de interceptação do próprio Burp. Se a validação
TLS de saída do Burp estiver habilitada e bloquear o certificado de teste,
importe somente a CA local de homologação para o projeto de teste; não desligue
a validação de forma global.

Ao terminar, pare apenas este projeto, sem remover seus volumes:

```bash
docker compose \
  --project-name "$TRACE_PRODUCTION_TEST_PROJECT" \
  --env-file "$TRACE_PRODUCTION_TEST_ENV_FILE" \
  -f docker-compose.production-test.yml \
  -f docker-compose.burp-test.yml \
  --profile burp down
```

## Limites da implantação atual

Este repositório não contém configuração de Cloudflare nem de um host público.
O TRACE implantado no PC industrial é local-first e não deve receber conexões
remotas de entrada. Portanto, este HAProxy é deliberadamente uma entrada local
de homologação, não um proxy público nem uma alteração no caminho de produção.
