# Implantação Windows do Trace

O Windows pode apresentar o Trace como um único aplicativo para o operador. O arquivo `TraceLauncher.cmd` inicia os containers locais, aguarda o healthcheck e abre Edge/Chrome/Chromium em modo quiosque. Se o navegador fechar, ele é reaberto automaticamente.

## Homologacao: instalacao e atualizacao da master

Crie o ZIP oficial de um commit limpo com `python3 scripts/build_windows_zip.py`. Ele inclui `.trace-source-commit`, usado para vincular a instalacao ao GitHub sem descartar arquivos locais. Extraia o ZIP em `C:\` e execute no **CMD**:

```cmd
cd /d C:\DallogixTrace
Instalar-PC-Windows.cmd
```

O comando prepara o `.env`, inicia o Docker, aplica as migrations, configura a ativacao local e registra uma tarefa que consulta a versao **realmente servida pelo Central** a cada cinco minutos enquanto a conta tecnica estiver conectada. O commit informado pela API do Central deve pertencer a `master`; o PC nao avanca para um commit do GitHub que ainda nao chegou ao servidor. Alteracoes locais e carregamentos ativos adiam a atualizacao. Os detalhes ficam em `C:\DallogixTrace\armazenamento\updates\master-homologacao\atualizacao.log`.

Um ZIP comum baixado pelo botao do GitHub nao traz `.trace-source-commit`; para novas instalacoes, use o ZIP criado pelo comando acima. Uma instalacao antiga pode ser vinculada uma vez com `Configurar.cmd -OriginalCommit <sha-do-zip>`. Se os arquivos forem diferentes daquele commit, o configurador para e lista as diferencas sem apagar dados.

## Instalação

O pacote de produção é compilado com `Build-TraceSetup.ps1` a partir de uma **tag aprovada** (`vN.N.N`). O build grava a versão inicial no instalador e gera `TraceSetup.exe`; ele recusa código local alterado.

1. Use Windows 10/11 IoT Enterprise ou Windows Pro e instale Docker Desktop. Na primeira abertura, conclua a configuração do mecanismo Linux/WSL. O instalador encontra o Docker Desktop tanto em `Program Files` quanto na instalação por usuário em `AppData` e inicia o mecanismo se estiver parado; a instalação do Docker continua sendo um pré-requisito separado.
2. Execute o `TraceSetup.exe` aprovado com a conta técnica administradora. O assistente instala em `C:\DallogixTrace`, instala o WebView2 Runtime oficial se estiver ausente, cria o `.env` com segredos aleatórios quando necessário, aplica migrations e só conclui depois que o gateway Node-RED e a API de ativação estiverem saudáveis. A instalação inicial precisa de acesso à internet para validar a versão Central e, se necessário, baixar o Runtime WebView2.
3. Mantenha `WEB_BIND_ADDRESS=127.0.0.1`. Nenhum acesso remoto entra no PC industrial; todo gerenciamento remoto ocorre no servidor central.
4. O instalador cria `Dallogix Trace.lnk` na área de trabalho e no menu Iniciar. Ele também registra `DallogixTrace.exe` para iniciar após o login do Windows; o aplicativo inicia o Docker Desktop quando necessário, aguarda o mecanismo Linux e abre o Trace em tela cheia.
5. Depois de ativar o PC localmente com o código e o administrador da empresa, vincule a Dala na Master. O ID, o código e o token da Dala são opcionais durante a instalação inicial; não use valores fictícios.
6. Teste `DallogixTrace.exe` pela área de trabalho ou `TraceLauncher.cmd` com a conta técnica.
7. Configure a conta `trace-operator` para login automático e use Windows Assigned Access/Shell Launcher somente se o PC precisar iniciar diretamente no modo quiosque.
8. Mantenha uma conta técnica administrativa separada da conta do operador.

O sistema será apresentado ao operador como `TraceLauncher`, equivalente ao `Trace.exe`. A transformação opcional do `.cmd` em um `.exe` deve ser feita somente no instalador oficial da empresa; o comportamento e os serviços continuam os mesmos.

O assistente registra o `Dallogix Agent` e a tarefa `Dallogix Trace Atualizacao Estavel`. Ela consulta às 03:30 a última release assinada, exige que o Central já sirva a mesma versão e o mesmo commit, instala somente um manifesto com assinatura e SHA-256 válidos e nunca volta para uma versão anterior. O processo de publicação atualiza o Central antes de disponibilizar a release aos PCs. `machine-config.example.json` é apenas um modelo; tokens reais nunca devem entrar no repositório.

O launcher inicia explicitamente o perfil industrial do Compose, que mantém o gateway Node-RED e o worker da câmera ativos após reinicializações e atualizações. Para a câmera, use a alimentação própria de 12 V ou PoE e uma conexão RJ45 em interface de rede separada da usada pelo CLP. Configure o IP privado fixo e as credenciais RTSP uma única vez no arquivo `.env`; o [guia de captura](../../integracoes/node-red/README.md#captura-imediata) contém os campos e a sequência.

## Segurança do PC

- Desative suspensão, hibernação e reinicialização automática durante o turno.
- Programe atualizações do Windows fora da operação.
- Mantenha a porta web vinculada a `127.0.0.1`; não libere a interface local para a rede industrial.
- Não exponha MySQL, Node-RED ou Modbus; o Compose já os mantém em `127.0.0.1` por padrão.
- Não habilite escrita física no CLP sem mapa de I/O, intertravamentos e teste de bancada homologados.

## Diagnóstico

```powershell
docker compose ps
docker compose logs --tail=100
Invoke-WebRequest http://127.0.0.1:8080/api/health.php
```

O launcher não cobra, não bloqueia o Windows e não altera dados de produção. O bloqueio mensal continua sendo manual pelo administrador Master dentro do Trace.

O assistente de instalação nunca aprova o mapa de I/O. Até a aprovação documental e de bancada, `physical_clp_enabled` permanece `false` e `io_map_status` permanece `CONFIRMAR`; a seleção de uma conexão física prevista pode identificar o modo `PHYSICAL`, mas não habilita escrita. Nessa condição, o Agent envia presença e saúde, mas nenhuma escrita física no CLP é permitida.

O `TraceAgent` mantém a presença da máquina no servidor central por HTTPS/443, iniciado pelo PC industrial. O heartbeat não depende de conexões recebidas e não exige abertura de porta no roteador. Se a internet cair, o Agent registra a falha, enquanto o Trace continua operando localmente com o CLP e a fila de sincronização.

## Atualizações remotas

`TraceUpdater.ps1` valida manifesto, assinatura e SHA-256, bloqueia a troca durante carregamentos, para os escritores, faz backup, aplica migrations e só registra a versão depois de verificar PHP e MySQL. Em falha, tenta restaurar arquivos e banco e registra a versão falha para evitar tentativas repetidas. A tarefa roda como `SYSTEM`; o log fica em `armazenamento\logs\update-stable.log`. O contrato completo está em [documentacao/operacao/atualizacoes-remotas.md](../../documentacao/operacao/atualizacoes-remotas.md).

Instalacoes Windows anteriores precisam receber uma vez o novo instalador de release para obter a tarefa e o marcador da versão. Publicar uma tag no GitHub nao altera PCs que ainda nao foram preparados para atualizacao automatica.
