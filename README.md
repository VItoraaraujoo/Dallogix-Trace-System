# Dallogix Trace

Sistema local-first para controle e rastreabilidade de carregamento de sacarias em esteiras industriais.

## Tecnologias

HTML, CSS, JavaScript, PHP, MySQL, Node-RED, Nginx, Docker e Docker Compose.

## Estado atual

Operação local-first integrada. Cada tela possui seu próprio HTML (`interface/*.html`) com núcleo compartilhado em `js/aplicacao.js`; login em `index.html`. O ambiente base, operação persistida, auditoria, fila de sincronização, monitoramento, ocorrências, catálogo, importação transacional, preparação e encerramento de carregamentos, captura seletiva de evidências, retenção automática de imagens e dados operacionais, relatório CSV e controles por perfil estão disponíveis.

A reversão e as ações configuráveis por Dala usam uma fila própria para o gateway industrial: o painel só registra a solicitação; o gateway autenticado confirma ou rejeita o comando após validar o CLP. Gatilhos, como atingir 100% da quantidade planejada, seguem a mesma fila. Nenhuma escrita física é feita pelo servidor. A ligação real ainda depende do mapa de I/O homologado, do programa Ladder e dos testes de bancada.

## Credenciais locais

O seed cria usuários de demonstração com troca obrigatória de senha no primeiro login. As senhas abaixo existem somente para inicializar um ambiente local e não são aceitas como configuração de produção:

- `admin@dallogix.local` / `password` — administrador da empresa.
- `supervisor@dallogix.local` / `password1234` — supervisor local.
- `operador@dallogix.local` / `password1234` — operador local.
- `master@dallogix.local` / `password` — administrador Dallogix.

Novas empresas recebem automaticamente um domínio lógico de acesso, derivado do
nome cadastrado, como `dallogix.empresa-chat`. O login pode então ser
`admin@dallogix.empresa-chat`, `joao@dallogix.empresa-chat` ou outro prefixo
escolhido no gerenciamento de logins. O domínio antigo do seed permanece válido
para compatibilidade com o ambiente local.

No perfil Master, uma empresa pode ser **arquivada** sem perder usuários,
romaneios, leituras, auditoria ou configurações. Enquanto arquivada, ela não
aceita login, novos acessos, ativações ou alterações de licença; os dados ficam
disponíveis para consulta administrativa. A opção **Restaurar** libera o acesso
novamente. A opção **Excluir definitivamente** só aparece para uma empresa
arquivada e exige uma confirmação separada; se houver vínculos, a confirmação
seguinte apaga também os dados relacionados de forma irreversível.

## Executar

1. Copie `.env.example` para `.env` e ajuste os valores.
2. Execute `docker compose up -d --build`.
3. Acesse `http://localhost:8080` no quiosque do PC industrial.
4. Verifique a API local em `http://localhost:8080/api/index.php`.
5. Verifique a saúde em `http://localhost:8080/api/health.php`.

Para validar o transporte do CLP virtual, execute `python3 scripts/test_modbus_virtual.py` com os containers ativos. O teste escreve e lê somente a memória do simulador em `127.0.0.1:1502`.

## Testar com configuração de produção

Execute `python3 scripts/production_test.py` para preparar um ambiente isolado em
`https://localhost:8443`, com banco separado e credenciais novas. Veja os acessos,
os testes e os limites em [teste de produção local](documentacao/operacao/teste-producao-local.md).

## Banco local

Com os containers ativos, aplique as migrations controladas e o seed:

```bash
./scripts/migrate.sh
docker compose exec -T mysql mysql -u root -pchange-me-root trace_local < banco-de-dados/seeds/001_local_seed.sql
```

Em uma instalação já existente, `scripts/migrate.sh` cria o controle de versão e registra o schema legado sem reaplicar migrations históricas. As migrations mais recentes adicionam o código de ativação permanente, o arquivamento separado da exclusão definitiva e o índice composto da listagem de usuários.

O seed cria uma empresa, usuário administrador, máquina, esteira, produto e barcode para desenvolvimento local.

As credenciais técnicas locais do seed são `TRACE_DEVICE_TOKEN=trace-device-local-token-2026-v1` para o CLP e `CAMERA_DEVICE_TOKEN=trace-camera-local-token-2026-v1` para a câmera. Em uma instalação real, gere tokens próprios e provisione cada dispositivo com `php scripts/provision_device.php`.

## Acesso remoto e servidor central

Não existe uma tela remota no PC industrial. Todo gerenciamento fora da máquina deve ser feito pelo servidor central. O PC industrial inicia as conexões de saída HTTPS para heartbeat e sincronização; não há port forwarding. A operação PC industrial ↔ CLP e o banco/fila local continuam disponíveis durante quedas de internet.

O serviço `sync-worker` reserva eventos em lotes, envia com timeout e backoff e recupera reservas abandonadas. Quando `SYNC_REMOTE_BATCH_URL` é configurada, o worker usa o contrato HTTP de lote; sem ela, mantém compatibilidade com o endpoint individual `SYNC_REMOTE_URL`. O serviço `image-retention` executa diariamente a limpeza de imagens e a retenção segura de leituras, eventos de sensor, auditoria confirmada, fila enviada e logs de erro. Os prazos podem ser ajustados no `.env`; registros de auditoria só são removidos quando existe entrega confirmada e nenhuma tentativa pendente.

O horário da aplicação segue o relógio do PC industrial quando a internet está indisponível. Com conexão, `/api/relogio.php` consulta o servidor central e a interface aplica somente a diferença de horário enquanto a conexão permanecer disponível; ao perder a conexão, volta imediatamente ao relógio do PC. O Trace não altera o relógio do Windows ou do macOS. Para registros persistidos, a instalação local continua usando o horário local offline e o servidor central usa o próprio horário ao receber os eventos.

`/api/health.php` informa a versão e o SHA implantados. `/api/prontidao.php` informa profundidade/idade da fila, heartbeats, comandos travados, schema e espaço livre. Fila pendente sem erro pode ser normal quando a sincronização remota está desabilitada; o healthcheck degrada quando há erro, atraso acima do limite ou risco operacional.

O deploy automático do servidor de teste ocorre pelo workflow [`.github/workflows/deploy-test.yml`](.github/workflows/deploy-test.yml) depois que os checks de qualidade e segurança aprovam o mesmo commit da `master`, usando SSH e healthcheck. A atualização de arquivos é feita sem parar ou recriar os containers existentes; o Nginx recebe apenas um reload gracioso, e o release é validado pelo SHA publicado. A `master` é a fonte de verdade da aplicação operacional; a `main` não deve ser usada para deploy. Os segredos de acesso ficam somente no ambiente protegido `test` do GitHub. A publicação de produção ocorre somente por tags de versão no workflow [`.github/workflows/release-production.yml`](.github/workflows/release-production.yml).

Credencial local inicial: `admin@dallogix.local` / `password`. A senha definida no cadastro é válida imediatamente e não exige troca no primeiro acesso.

## Ativação do PC industrial

Ao criar uma empresa no site com o perfil Master, o Trace gera um código de ativação único e permanente e o exibe em **Gerenciar empresa** para cópia. No primeiro acesso da instalação local, informe esse código e o login do administrador da empresa. O PC envia o código ao servidor central, que calcula o hash e confirma a empresa; depois valida as credenciais do administrador da mesma empresa, cria o acesso local e registra a ativação. Nas aberturas seguintes, a tela de login mostra `Licença ativa` e não solicita o código novamente.

No PC industrial, configure `TRACE_INSTALLATION_MODE=local` e `TRACE_CENTRAL_URL` com a URL base do servidor central. No servidor remoto, configure `TRACE_INSTALLATION_MODE=central`; nesse ambiente o formulário de ativação não aparece e o login remoto permanece normal. Se o modo ficar vazio, o Trace considera ambientes diferentes de produção como locais e produção como central.

## Parar e reiniciar

```bash
docker compose down
docker compose up -d
```

## Backup e restauração local

Crie um backup consistente do banco local com:

```bash
bash scripts/backup_db.sh
```

Valide a integridade de um backup antes de restaurá-lo:

```bash
bash scripts/verify_backup.sh armazenamento/backups/trace_local_YYYYMMDDTHHMMSSZ.sql
```

Restaure somente um arquivo escolhido explicitamente:

```bash
bash scripts/restore_db.sh armazenamento/backups/trace_local_YYYYMMDDTHHMMSSZ.sql
```

Em produção, a restauração exige `TRACE_ALLOW_RESTORE=1` definido conscientemente.

## Pendências técnicas

- Sufixo exato, protocolo e mapa de registradores do CLP Delta DVP14SS.
- Escolha da interface física do scanner Elgin EL8600 (USB ou RS-232), terminador e formato de leitura.
- Endereço e protocolo da câmera IP.
- Credenciais e endpoint da nuvem Dallogix.

O licenciamento mensal é controlado manualmente pelo Master Dallogix; o Trace não realiza cobranças automáticas nem integra gateways de pagamento.

As decisões externas estão organizadas em [documentacao/pendencias/decisoes-pendentes.md](documentacao/pendencias/decisoes-pendentes.md). O desenvolvimento local-first não depende dessas informações para continuar.

O procedimento de preparação para um servidor físico está em [documentacao/operacao/implantacao-servidor-fisico.md](documentacao/operacao/implantacao-servidor-fisico.md).

Para PC industrial Windows, use o launcher e as orientações em [implantacao/windows/README.md](implantacao/windows/README.md). A preparação técnica usa `Install-TraceMachine.ps1` e vincula o `Dallogix Agent`; a interface pode funcionar como aplicativo quiosque, mantendo os serviços locais separados.

O instalador visual para a equipe técnica é definido em [implantacao/windows/TraceSetup.iss](implantacao/windows/TraceSetup.iss) e gera `TraceSetup.exe` quando compilado no Inno Setup em uma máquina Windows. Credenciais e configurações específicas nunca entram no pacote.

Atualizações remotas seguras, com manifesto assinado, bloqueio durante operação, backup e rollback, estão descritas em [documentacao/operacao/atualizacoes-remotas.md](documentacao/operacao/atualizacoes-remotas.md).

O timer systemd de atualização automática fica desabilitado por padrão. Só deve ser habilitado após criar conscientemente `/etc/dallogix-trace/enable-auto-update` e configurar manifesto, chave pública e janela de manutenção. O caminho legado `scripts/sync_github_archive.sh` agora apenas encaminha para `scripts/update_trace.sh`.

No PC local macOS, a sincronização direta da `master` pode ser instalada com `bash scripts/install_macos_auto_sync.sh`. O LaunchAgent consulta o `origin/master` a cada 60 segundos, aplica somente avanços fast-forward, executa migrations, reconstrói os serviços e valida o healthcheck. Alterações locais ou carregamentos ativos fazem a atualização ser adiada; os registros ficam em `armazenamento/logs/sync-master.log`. Se o projeto estiver em uma pasta protegida pelo macOS, como `Documents`, o usuário precisa conceder Acesso Total ao Disco ao processo autorizado ou mover a instalação para uma pasta de trabalho não protegida. Essa rotina é para a instalação local de desenvolvimento/homologação; produção continua usando releases assinadas.

Antes de uma implantação física, carregue o `.env` no ambiente e execute `bash scripts/check_production_env.sh` para validar os requisitos mínimos sem revelar segredos.

Para subir uma instalação de produção, use `bash scripts/deploy_production.sh .env up -d --build --remove-orphans`. Esse comando valida o ambiente antes de iniciar os serviços e usa `docker-compose.production.yml`, que exige senhas, tokens, HTTPS e bind definidos explicitamente. O `docker-compose.yml` sem o overlay continua reservado ao desenvolvimento local.

## Convenção de nomenclatura

Para manter o sistema consistente em português na camada funcional, o projeto prioriza nomes em português para módulos de negócio, telas, operações, relatórios e regras. Nomes de infraestrutura e tecnologias continuam em inglês ou no padrão das ferramentas, para preservar compatibilidade com Docker, Nginx, PHP, MySQL e Node-RED.

A regra completa está em [documentacao/arquitetura/convensao-nomenclatura.md](documentacao/arquitetura/convensao-nomenclatura.md).

## Qualidade e arquitetura

O padrão de camadas e as regras para novas alterações estão em [documentacao/arquitetura/padrao-desenvolvimento.md](documentacao/arquitetura/padrao-desenvolvimento.md). Antes de alterar o sistema, execute:

```bash
bash testes/qualidade.sh
```
