<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Contexto do projeto

Dallogix Trace é um sistema **local-first** para controle e rastreabilidade
de carregamento de sacarias em esteiras industriais. Stack: HTML/CSS/JS puro
(`interface/*.html`, núcleo em `js/aplicacao.js`), PHP (`api/`), MySQL,
Node-RED, Nginx, Docker/Docker Compose.

Pontos importantes antes de mexer em qualquer coisa:

- Não existe tela remota no PC industrial. Todo gerenciamento fora da
  máquina é feito pelo servidor central; o PC industrial só abre conexões
  de saída (HTTPS) para heartbeat/sincronização — nunca assuma port
  forwarding ou endpoint remoto acessível diretamente do PC industrial.
- Nenhuma escrita física no CLP é feita pelo servidor diretamente: painel
  registra a solicitação, o gateway industrial autenticado confirma ou
  rejeita após validar o CLP.
- Antes de alterar o sistema, rode:
  ```bash
  bash testes/qualidade.sh
  ```
  Padrão de camadas e regras de alteração em
  `documentacao/arquitetura/padrao-desenvolvimento.md`.
- Convenção de nomenclatura: português para módulos de negócio, telas,
  operações e regras; inglês para infraestrutura (Docker, Nginx, PHP,
  MySQL, Node-RED). Regra completa em
  `documentacao/arquitetura/convensao-nomenclatura.md`.

## Comandos úteis para verificação

```bash
docker compose up -d --build                     # subir o ambiente local
curl http://localhost:8080/api/health.php         # versão/SHA implantados
curl http://localhost:8080/api/prontidao.php      # fila, heartbeats, schema, espaço livre
python3 scripts/test_modbus_virtual.py            # valida o CLP virtual em 127.0.0.1:1502
bash testes/qualidade.sh                          # antes de qualquer alteração
python3 scripts/production_test.py                # ambiente de produção isolado (https://localhost:8443)
```

## Evitar loop em erro

Regras para não travar repetindo a mesma tentativa de correção sem sair do
lugar — especialmente relevante aqui, onde o mesmo sintoma pode vir de
camadas bem diferentes (PHP/API, MySQL/migrations, CLP virtual/Modbus,
Docker/Nginx, fila de sincronização).

1. **Limite de tentativas por erro** — se a mesma mensagem de erro
   aparecer 2x seguidas após tentativas de correção, pare de repetir a
   mesma abordagem e mude de estratégia.

2. **Diagnosticar antes de corrigir** — leia o log/stack trace completo e
   identifique a causa raiz antes de mexer em código. Para falhas de
   comunicação com o CLP, comece checando a saída de
   `scripts/test_modbus_virtual.py` e `/api/prontidao.php` antes de
   suspeitar do código da aplicação.

3. **Isolar a menor reprodução do erro** — reduza ao trecho mínimo que
   falha (uma rota da API, uma leitura Modbus, uma migration) em vez de
   rodar o sistema inteiro a cada tentativa.

4. **Registrar o que já foi tentado** — evite repetir a mesma correção já
   descartada.

5. **Trocar de camada quando travar** — se o erro persiste após 2-3
   tentativas na mesma camada, verifique as outras antes de continuar
   ali. Ordem de suspeita sugerida para este projeto quando um teste de
   comunicação ou sincronização falha:
   - `.env` / variáveis de ambiente (tokens, `TRACE_ALLOWED_DEVICE_HOSTS`,
     `TRACE_INSTALLATION_MODE`, URLs de sync)
   - Docker/rede (containers ativos, porta `127.0.0.1:1502` do CLP
     virtual, Nginx)
   - Banco/migrations (`scripts/migrate.sh`, schema desatualizado)
   - Protocolo Modbus (endereço de registrador, unit id, function code)
   - Fila/sincronização (`sync-worker`, `SYNC_REMOTE_BATCH_URL` /
     `SYNC_REMOTE_URL`, `/api/prontidao.php`)
   - Código da aplicação (PHP/API, frontend)

6. **Parar e reportar, não insistir** — após 3 tentativas sem sucesso,
   pare, resuma o que foi tentado, os erros obtidos e as hipóteses
   restantes, em vez de continuar tentando indefinidamente ou forçar uma
   solução com gambiarra.

7. **Nunca silenciar o erro para "fazer passar"** — proibido suprimir
   exceções, comentar testes que falham, usar `try/catch` vazio, ou
   ajustar dados/mocks só para o teste parar de acusar erro sem resolver
   a causa real.

8. **Confirmar antes de mudanças destrutivas** — mudanças como rodar
   `scripts/restore_db.sh`, apagar migrations, arquivar/excluir uma
   empresa, ou reprovisionar tokens (`scripts/provision_device.php`, que
   invalida a credencial anterior) como tentativa de "resolver" exigem
   confirmação explícita antes de executar.

## Comando /reset-debug

Quando o usuário digitar `/reset-debug`, esqueça todas as tentativas
anteriores de solução que falharam neste chat. Esvazie o viés de
confirmação e siga estes passos estritos:

1. ASSUMA que a sua abordagem anterior estava 100% errada.
2. LEIA o erro original novamente como se fosse a primeira vez.
3. EXPLIQUE a causa raiz do erro em apenas uma frase.
4. PROPONHA uma estratégia totalmente diferente da anterior (mude a
   biblioteca, a lógica ou a estrutura).
5. FORNEÇA o código/solução corrigido de forma direta.
