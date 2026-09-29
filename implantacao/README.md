# Implantação do PC industrial

O PC industrial com interface gráfica usa o Trace em modo quiosque: o operador vê somente `http://127.0.0.1:8080` e não acessa a área de trabalho ou outros aplicativos pelo fluxo normal.

## Instalação

1. Copie o projeto para `/opt/dallogix-trace`.
2. Crie o `.env` e valide-o com `bash scripts/check_physical_deployment.sh`. Mantenha `WEB_BIND_ADDRESS=127.0.0.1`: nenhum acesso remoto entra no PC industrial. Todo gerenciamento remoto ocorre no servidor central. `BIND_ADDRESS=127.0.0.1` permanece obrigatório para MySQL, Node-RED e Modbus.
3. Instale o Chromium/Chrome e configure o usuário operador com login automático no ambiente gráfico.
4. Copie `dallogix-trace.service`, `dallogix-trace-kiosk.service`, `dallogix-trace-sync.service` e `dallogix-trace-sync.timer` de `deploy/systemd/` para `/etc/systemd/system/` e habilite:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dallogix-trace.service dallogix-trace-kiosk.service dallogix-trace-sync.timer
```

O serviço do Trace sobe o perfil industrial, incluindo Node-RED e o worker de câmera; o serviço quiosque abre o navegador em tela cheia e o reinicia se ele fechar. Para a câmera, use a fonte própria de 12 V ou PoE e uma interface Ethernet separada do CLP, configure um IP privado fixo e preencha as credenciais RTSP no `.env`. O [guia de captura](../integracoes/node-red/README.md#captura-imediata) descreve a preparação única. O timer consulta a cada minuto o pacote assinado produzido a partir da `master`; não instala nada enquanto existir carregamento ou intervenção. O atualizador usa por padrão o manifesto estável do GitHub e a chave pública que acompanha o projeto. O arquivo de serviço assume um usuário Linux chamado `trace-operator`, sessão gráfica em `DISPLAY=:0` e Xauthority em `/home/trace-operator/.Xauthority`; ajuste esses valores se a distribuição usar outra sessão. A conta administrativa do Linux deve ser separada da conta operador e acessível somente à equipe técnica.

## Manutenção

```bash
sudo systemctl status dallogix-trace.service dallogix-trace-kiosk.service
docker compose --profile industrial ps
docker compose --profile industrial logs --tail=100
```

Não exponha as portas do MySQL, Node-RED, Modbus ou da interface web local fora do PC industrial. O PC inicia as conexões de saída HTTPS para o servidor central; não é necessário port forwarding no roteador da empresa. A comunicação PC industrial ↔ CLP continua local e a operação permanece disponível sem internet.

## Atualizações remotas

As atualizações são assinadas, verificadas por SHA-256, bloqueadas durante qualquer carregamento e protegidas por backup, healthcheck e rollback. O timer consulta automaticamente a cada minuto. Siga [documentacao/operacao/atualizacoes-remotas.md](../documentacao/operacao/atualizacoes-remotas.md) para conferir a instalação e habilitar o mesmo padrão em máquinas já implantadas.

## Sincronização com GitHub

O repositório do servidor deve ter o remote `empresa` apontando para `https://github.com/VItoraaraujoo/Dallogix-Trace-System.git`, autenticado por SSH ou pelo gerenciador de credenciais do sistema. Para preparar/verificar a sincronização sem alterar nada, execute `TRACE_GITHUB_DRY_RUN=1 bash scripts/sync_github.sh`. A execução normal aceita somente fast-forward, preserva `.env` e `armazenamento/`, reconstrói o Compose e exige healthcheck. Não use essa sincronização durante carregamentos ativos; para produção, prefira o fluxo de pacote assinado descrito acima.

O workflow `.github/workflows/deploy-test.yml` executa somente os checks de qualidade e segurança; ele não publica arquivos em servidores. O deploy e a publicação de produção são acionados manualmente pelo workflow `.github/workflows/release-production.yml`, depois que uma tag aprovada já aponta para um commit da `master`.

Linux e Windows consultam uma release assinada a cada minuto e adiam a instalação enquanto houver carregamento ativo. A release só aparece depois que o Central foi atualizado e a API confirmou a mesma versão e o mesmo commit. Linux e Windows validam assinatura e integridade, fazem backup, healthcheck e rollback; no macOS a sincronização existente aplica fast-forward e valida o healthcheck. As chaves SSH e de assinatura e o caminho do Central devem ser configurados no ambiente protegido `production-release`, conforme [o procedimento de publicação](../documentacao/operacao/atualizacoes-remotas.md#publicação-pelo-github). Instalações Linux/Windows que já estavam em campo precisam receber uma única ativação técnica do timer/tarefa.
