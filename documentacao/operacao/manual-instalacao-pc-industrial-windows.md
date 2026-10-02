# Manual de instalação — PC industrial Windows

Este procedimento instala o Trace como operação local de produção. O banco e a interface permanecem no PC industrial; o servidor central é usado para gestão e sincronização quando houver internet.

## 1. Pré-requisitos

- Windows 10/11 Pro ou IoT Enterprise 64 bits, atualizado fora do turno;
- conta técnica local com permissão de administrador;
- Docker Desktop instalado e iniciado;
- Edge ou Chrome instalado;
- disco com pelo menos 30 GB livres e Wi-Fi industrial estável;
- IP, porta e protocolo do CLP confirmados; a câmera pode ser configurada depois.

Crie duas contas Windows: `trace-operator`, sem privilégios administrativos, e `trace-tech`, exclusiva para manutenção. A conta técnica não deve ser usada na operação diária.

### Wi-Fi industrial

Use uma rede Wi-Fi industrial dedicada, protegida por WPA2/WPA3, com reserva DHCP ou IP previsível para o PC. Posicione o ponto de acesso para manter sinal estável na área da esteira e desative a economia de energia do adaptador Wi-Fi no Windows. O PC deve reconectar automaticamente após reinício ou perda de sinal.

Mesmo conectado por Wi-Fi, a interface do Trace permanece limitada a `127.0.0.1`: outros dispositivos da rede não acessam o sistema local. O PC usa a rede apenas para sincronizar com o servidor central por HTTPS.

## 2. Copiar e configurar o pacote

1. Gere `TraceSetup.exe` de uma tag aprovada com `Build-TraceSetup.ps1` e copie o executável para o PC.
2. Execute o instalador como administrador pela conta técnica. Ele instala em `C:\DallogixTrace`, cria o atalho `Dallogix Trace` na área de trabalho, registra a inicialização após o login do Windows, cria `.env` com senhas e tokens aleatórios se o arquivo ainda não existir, instala Git for Windows quando necessário, sobe os serviços e aplica migrations.
3. O assistente solicita o endereço base HTTPS do servidor central e o nome do PC industrial. O ID, o código e o token da Dala ficam opcionais na instalação inicial: deixe o ID vazio quando o PC ainda não estiver vinculado; a Dala será vinculada depois da ativação na Master. Guarde qualquer token técnico fora de capturas e logs.

Se `.env` já existir, o instalador preserva seus valores e informa quais campos obrigatórios estão vazios. Depois provisione cada dispositivo com `scripts/provision_device.php` e token próprio.

Quando o adaptador de rede dedicado estiver conectado, configure IP privado fixo para a câmera e preencha `CAMERA_RTSP_HOST`, `CAMERA_RTSP_USERNAME` e `CAMERA_RTSP_PASSWORD` no mesmo arquivo. Até essa etapa, o worker inicia automaticamente e mantém a câmera como OFFLINE; a fila aguarda a conexão para capturar. Siga o [guia de captura da câmera](../../integracoes/node-red/README.md#captura-imediata).

No PC industrial, cadastre o endereço e a porta de cada CLP na própria Dala.
Ao salvar, o Trace tenta abrir uma conexão TCP para esse destino, limitado a
IPv4 privado. O servidor central não acessa a rede Modbus da fábrica:
ele recebe o status sincronizado pelo PC industrial. Depois da
migration 048, reexecute a ativação da instalação
para trocar o antigo código de ativação por um token aleatório de sincronização.

Mantenha `WEB_BIND_ADDRESS=127.0.0.1` e `BIND_ADDRESS=127.0.0.1`. Assim a interface, MySQL e serviços técnicos não ficam expostos na rede industrial.

Defina os perfis conforme o uso:

```dotenv
# Produção no PC industrial
COMPOSE_PROFILES=industrial

# Somente em bancada, quando o simulador for necessário
# COMPOSE_PROFILES=industrial,simulation
```

Mantenha `APP_ENV=local` enquanto o quiosque acessar `http://127.0.0.1:8080`. Esse valor permite a sessão segura no endereço local sem exigir certificado HTTPS. O PC ainda é uma instalação de produção operacional.

## 3. Registrar a máquina

O `TraceSetup.exe` executa essa preparação automaticamente. Se for necessário repetir a configuração com a conta técnica, execute:

```powershell
.\implantacao\windows\Setup-TraceMachine.ps1
```

Informe o nome cadastrado para o PC industrial, `https://trace.santocloud.com.br` como servidor central e, se já houver Dala vinculada, o ID, o código e a credencial exclusiva dela. Caso contrário, deixe o ID do equipamento vazio. Na primeira instalação, responda `N` para CLP físico habilitado.

O instalador inicia os containers, agenda a verificação diária de releases assinadas para 03:30 e registra o agente do Trace somente quando uma Dala já estiver vinculada. Consulte `schtasks.exe /Query /TN "Dallogix Trace Atualizacao Estavel" /V /FO LIST` no CMD para confirmar o registro. O log fica em `C:\DallogixTrace\armazenamento\logs\update-stable.log` após a primeira consulta.

## 4. Validar a instalação local

No navegador técnico, abra:

```text
http://127.0.0.1:8080/api/health.php
```

O resultado de `health.php` deve ser HTTP 200 com `status=ok`, `php=true` e `mysql=true`. Consulte também `http://127.0.0.1:8080/api/prontidao.php` para verificar se fila, heartbeat, comandos e disco estão prontos para operação; `status=degraded` exige análise antes do go-live. Em seguida, abra `http://127.0.0.1:8080`, entre com um login autorizado e confirme cadastro de Dala, romaneio e logs.

Para bancada, habilite o perfil `simulation` e execute o teste Modbus virtual. Não conecte comandos físicos nessa etapa.

## 5. Modo quiosque do operador

Teste o launcher com a conta técnica:

```powershell
.\implantacao\windows\TraceLauncher.cmd
```

Ele inicia os serviços locais, aguarda o healthcheck e abre o Trace em tela cheia. Configure `trace-operator` no Assigned Access ou Shell Launcher do Windows para iniciar esse launcher automaticamente. Se o navegador fechar, ele é reaberto.

O operador não deve ter acesso ao desktop, Explorer, configurações ou terminal. A manutenção ocorre somente após entrar com `trace-tech`.

## 6. Homologar CLP e câmera

Antes de habilitar CLP físico, registre e valide: modelo, IP, porta, protocolo, Unit ID, mapa de registradores, permissivos, retorno de estado, timeout, parada de emergência e reversão. A aplicação nunca substitui os intertravamentos do CLP.

Depois da homologação em bancada, altere a configuração para habilitar o CLP físico e reinicie os serviços em uma janela de manutenção. Configure a câmera com endereço, protocolo e credencial fora da interface do operador.

## 7. Backup e atualização

Faça um backup inicial após a homologação. As atualizações devem ocorrer fora do turno, sem carregamento ativo. O agente de atualização valida pacote assinado, cria backup e executa healthcheck antes de liberar a nova versão.

## 8. Diagnóstico rápido

```powershell
docker compose ps
Invoke-WebRequest http://127.0.0.1:8080/api/health.php
Get-ScheduledTask -TaskName "Dallogix Trace Agent"
```

Se a operação estiver parada e o healthcheck falhar, entre com `trace-tech`, preserve os logs em `C:\DallogixTrace\logs` e acione a manutenção.
