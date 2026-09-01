# Dallogix Trace

Sistema local-first para controle e rastreabilidade de carregamento de sacarias em esteiras industriais.

## Tecnologias

HTML, CSS, JavaScript, PHP, MySQL, Node-RED, Nginx, Docker e Docker Compose.

## Estado atual

Operação local-first integrada. Cada tela possui seu próprio HTML (`interface/*.html`) com núcleo compartilhado em `js/aplicacao.js`; login em `index.html`. O ambiente base, operação persistida, auditoria, fila de sincronização, monitoramento, ocorrências, catálogo, importação transacional, preparação e encerramento de carregamentos, captura seletiva de evidências, retenção automática de imagens, relatório CSV e controles por perfil estão disponíveis.

A reversão também possui uma fila própria para o gateway industrial: o painel só registra a solicitação; o gateway autenticado confirma ou rejeita o comando após validar o CLP. Nenhuma escrita física é feita pelo servidor. A ligação real ainda depende do mapa de I/O homologado, do programa Ladder e dos testes de bancada.

## Credenciais locais

- `admin@dallogix.local` / `password` — administrador da empresa (operação local).
- `supervisor@dallogix.local` / `password1234` — supervisor local (teste).
- `operador@dallogix.local` / `password1234` — operador local (teste).
- `master@dallogix.local` / `password` — administrador Dallogix (menu "Empresas" com todas as empresas e dashboards gerenciais).

## Executar

1. Copie `.env.example` para `.env` e ajuste os valores.
2. Execute `docker compose up -d --build`.
3. Acesse `http://localhost:8080` no quiosque do PC industrial.
4. Verifique a API local em `http://localhost:8080/api/index.php`.
5. Verifique a saúde em `http://localhost:8080/api/health.php`.

Para validar o transporte do CLP virtual, execute `python3 scripts/test_modbus_virtual.py` com os containers ativos. O teste escreve e lê somente a memória do simulador em `127.0.0.1:1502`.

## Banco local

Com os containers ativos, aplique as migrations e o seed:

```bash
for migration in banco-de-dados/migrations/*.sql; do
  docker compose exec -T mysql mysql -u root -pchange-me-root trace_local < "$migration"
done
docker compose exec -T mysql mysql -u root -pchange-me-root trace_local < banco-de-dados/seeds/001_local_seed.sql
```

Em uma instalação já existente, aplique somente as migrations ainda não executadas. A mais recente é `018_consultas_operacionais.sql`.

O seed cria uma empresa, usuário administrador, máquina, esteira, produto e barcode para desenvolvimento local.

## Acesso remoto e servidor central

Não existe uma tela remota no PC industrial. Todo gerenciamento fora da máquina deve ser feito pelo servidor central. O PC industrial inicia as conexões de saída HTTPS para heartbeat e sincronização; não há port forwarding. A operação PC industrial ↔ CLP e o banco/fila local continuam disponíveis durante quedas de internet.

O deploy automático do servidor de teste ocorre pelo workflow [`.github/workflows/deploy-test.yml`](.github/workflows/deploy-test.yml) após alterações no branch `master`, usando SSH e healthcheck. Os segredos de acesso ficam somente no ambiente protegido `test` do GitHub.

Credencial local: `admin@dallogix.local` / `password`.

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

Antes de uma implantação física, carregue o `.env` no ambiente e execute `bash scripts/check_production_env.sh` para validar os requisitos mínimos sem revelar segredos.

## Qualidade e arquitetura

O padrão de camadas e as regras para novas alterações estão em [documentacao/arquitetura/padrao-desenvolvimento.md](documentacao/arquitetura/padrao-desenvolvimento.md). Antes de alterar o sistema, execute:

```bash
bash testes/qualidade.sh
```
