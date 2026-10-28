# Node-RED local

## Acesso administrativo

O editor e a Admin API exigem autenticação. Configure no `.env` um usuário
técnico e `NODE_RED_ADMIN_PASSWORD_HASH` com o hash bcrypt da senha, nunca a
senha em texto puro. No instalador Windows de um PC industrial, o hash é
provisionado durante a instalação quando ainda estiver vazio. Em outras
instalações, gere o hash com os comandos abaixo e grave-o entre aspas simples
no `.env`. Use uma senha com pelo menos 15 caracteres e no máximo 72 bytes em
UTF-8. Exemplo:

```sh
docker compose --profile industrial build node-red
docker compose --profile industrial run --rm --no-deps --entrypoint node-red node-red admin hash-pw
```

```dotenv
NODE_RED_ADMIN_USER=trace-admin
NODE_RED_ADMIN_PASSWORD_HASH='$2b$12$...'
```

O serviço falha ao iniciar se o usuário ou o hash estiver ausente/inválido.
Em produção, `BIND_ADDRESS` precisa ser `127.0.0.1` ou `::1`; mantenha o
editor fora da rede do cliente e use uma conta técnica para manutenção.

## Fluxo de referência

O arquivo `trace-clp-bridge.flow.json` pode ser importado no Node-RED local. Ele contém somente nós nativos e começa em modo seguro:

No Compose do projeto, o arquivo persistente é atualizado na inicialização:
somente a aba `TRACE • Gateway CLP` é substituída pela versão do pacote. O
arquivo anterior é copiado para backup e as demais abas do operador são
preservadas. Alterações manuais dentro da aba gerenciada são substituídas; o
backup conserva o fluxo anterior. Um fluxo sem essa aba é mantido sem alterações.

- testa uma leitura Modbus TCP do CLP e só publica `ONLINE` quando a resposta é válida;
- publica `OFFLINE` quando o CLP não responde, o endereço/porta são inválidos ou a resposta Modbus é inválida;
- consulta a fila de comandos a cada 2 segundos;
- reserva comandos pela API e prioriza `EMERGENCIA`;
- mantém toda escrita física bloqueada por padrão; para liberar, exige aprovação explícita, vínculo com o ID da Dala e quatro endereços Modbus válidos e distintos;
- lê o mapa da instalação a partir de `config/machine.json`, sem endereços de saída fixos no fluxo, e só conclui uma escrita depois de validar o eco FC5;
- abre um socket TCP por pedido Modbus e o fecha após a resposta ou o limite absoluto de 5 segundos, evitando respostas atrasadas contaminarem o próximo comando;
- exige leitura da bobina de retorno configurada em `emergency_feedback_coil` antes de concluir `DESBLOQUEAR_MAQUINA`;
- não substitui a emergência elétrica nem os intertravamentos do CLP;
- não acessa o banco diretamente.

Configure no ambiente do Node-RED:

```text
TRACE_API_URL=http://trace-api.local
TRACE_DEVICE_TOKEN=token-da-dala-deste-pc
TRACE_MODBUS_UNIT_ID=1
TRACE_MODBUS_HEARTBEAT_FUNCTION=1
TRACE_MODBUS_HEARTBEAT_REGISTER=2052
TRACE_MODBUS_SENSOR_REGISTER=2052
TRACE_SENSOR_ACTIVE_LEVEL=1
TRACE_SENSOR_SIGNAL_MODE=rising_edge
TRACE_PHYSICAL_CLP_ENABLED=0
TRACE_IO_MAP_STATUS=APPROVED
TRACE_MODBUS_MAP_EQUIPMENT_ID=0
TRACE_MODBUS_COIL_CONVEYOR_RUN=2049
TRACE_MODBUS_COIL_REVERSAL=2050
TRACE_MODBUS_COIL_EMERGENCY=2051
TRACE_MODBUS_COIL_EMERGENCY_FEEDBACK=17
```

Esse mapa aprovado é o do INVT TS621 enviado pelo usuário: M2049 liga o motor, M2050 liga o reverso, M2051 aciona a emergência, M17 devolve o estado da emergência e M2052 é o bit do sensor. O gateway consulta M2052 por FC1 a cada 200 ms, publica o status `SENSOR` após uma resposta Modbus válida e, por padrão, registra uma passagem na borda de subida. A primeira amostra após reiniciar só estabelece a linha de base, evitando contar um saco falso. `TRACE_SENSOR_ACTIVE_LEVEL` aceita `1` ou `0`; `TRACE_SENSOR_SIGNAL_MODE` aceita `rising_edge`, `falling_edge` ou `toggle`. A semântica real do Ladder ainda precisa de homologação física; pulsos menores que 200 ms podem não ser observados.

Cada PC industrial é dedicado a uma Dala e usa os tokens dos seus próprios gateways. A API devolve somente a Dala vinculada a esse dispositivo e fornece um destino IPv4 privado validado. O endereço da API deve apontar para a instalação local, nunca para a URL pública. Ao cadastrar ou sincronizar a Dala local, o Trace provisiona automaticamente os tokens CLP e CAMERA do `.env`; o comando `php scripts/provision_device.php` fica reservado para recuperação administrativa de uma instalação existente. O heartbeat usa unidade, função e endereço configurados no ambiente. O gateway só publica ONLINE depois de uma resposta Modbus válida; IP e porta continuam vindo do cadastro da Dala.

O instalador Windows gera `config/node-red-clp.env` a partir de `config/machine.json`. O exemplo contém o mapa aprovado do INVT TS621, mas começa com `physical_clp_enabled=false`; assim, instalar ou atualizar o pacote não inicia escritas físicas automaticamente. O assistente reconhece esse modelo, preenche M2049/M2050/M2051 e o retorno M17, e pergunta separadamente se os comandos físicos serão habilitados naquela máquina. Para outro modelo, mantém o mapa bloqueado até configurar os endereços corretos. A liberação valida o `equipment_id`, as três bobinas de saída e o endereço de retorno, rejeitando valores fora de 0–65535 ou repetidos. O gateway também compara o ID do mapa com o ID da Dala reservada. Um destino inválido ou protocolo diferente encerra o pedido sem escrever.

Para validar a fila de comandos em uma instalação descartável, habilite somente
nesse `.env` local `TRACE_LOCAL_SIMULATION=1` e
`TRACE_SIMULATOR_ONLY_COMMANDS=1`. O gateway verifica as transições simuladas, registra a resposta como teste e
nunca envia escrita Modbus ou saída física nesse modo. Em produção, deixe os
dois flags em `0`: os botões enviam FC5 e a API só recebe `APLICADO` quando o
eco físico é válido.

## Simulação no PC

Para testar a lógica sem CLP, importe também `trace-clp-simulador.flow.json`. Os botões do fluxo simulam iniciar, pausar, emergência, retorno, produto correto, produto incorreto e ausência de leitura. Os resultados aparecem no painel de debug do Node-RED, com `loading_state`, contagem, progresso e evento gerado.

Sequência sugerida: `Resetar` → `Iniciar` → vários `Sensor + produto correto` → `Pausar` → `Retorno`. Depois repita com `Produto incorreto`, `Sensor sem leitura` e `Emergência`. Essa simulação usa somente o contexto do Node-RED e não chama a API nem o CLP real.

O perfil `simulation` sobe um único servidor `modbus-virtual` em `127.0.0.1:1502`. Ele implementa leitura de coils/entradas/registros e escrita de coil/registro em memória, para testes de transporte Modbus TCP. O fluxo operacional `trace-clp-bridge.flow.json` lê o endereço e a porta da Dala cadastrada. O mapa da simulação está em `integracoes/industrial/register-map.example.json`; ele não deve ser reutilizado como mapa de produção. A simulação de comandos não envia escrita Modbus. Em operação física, as escritas permanecem bloqueadas até uma aprovação explícita da instalação.

O [contrato provisório de simulação](../industrial/contrato-provisorio-simulacao.md) documenta os limites dessa bancada e os cenários automatizados com `node --test testes/clp-provisorio-simulacao.mjs`. Ele não envia escrita ao CLP quando os dois flags de simulação estão ativos.

## Sinal de contagem e leitor

O CLP informado para a bancada é o INVT TS621, ligado por Modbus TCP. O mapa de comandos foi aprovado; o documento histórico `mapa-io-candidato.md` descreve outro equipamento e não deve orientar a configuração desta Dala.

O Elgin EL8600 é USB HID (teclado): a tela de Operação mantém o campo do leitor focado e o servidor associa cada código à passagem pendente mais recente da mesma Dala. Essa associação também cobre a pequena diferença de tempo em que o código chega antes do evento Modbus. Um código recebido depois da passagem é associado ao evento pendente mais recente, dentro de `TRACE_SCANNER_NO_READ_TIMEOUT_MS` (padrão 1500 ms); assim, uma leitura posterior não ocupa uma passagem que já venceu. Se não chegar código nesse prazo, o gateway finaliza a passagem como `SEM_LEITURA`, registra a ocorrência e solicita uma foto; o carregamento não é pausado por essa falha. A API serializa a leitura e o timeout por carregamento, para que o mesmo evento não gere dois resultados. O POST do evento repete até três vezes com o mesmo identificador quando há falha temporária, sem duplicar registros. A comunicação do teclado USB só é comprovada quando uma leitura é recebida; a ausência de leituras não significa que o scanner esteja desconectado.

## Heartbeat dos dispositivos

O gateway verifica e publica o heartbeat do CLP a cada **1 segundo**. A leitura do sensor M2052 ocorre a cada **200 ms**; o status `SENSOR` só fica ONLINE após uma resposta Modbus válida e passa a OFFLINE quando a comunicação falha. Eventos de passagem usam somente leitura FC1 e não enviam escrita ao CLP. O timeout de leitura consulta o servidor local uma vez por segundo enquanto há carregamento ativo, para retomar passagens pendentes após reinício do Node-RED.

## Sincronização remota

O servidor mantém eventos em `fila_sincronizacao`. O processamento envia dados
quando `SYNC_REMOTE_URL` ou `SYNC_REMOTE_BATCH_URL` estiver configurada no `.env`;
sem essas variáveis, os eventos permanecem `PENDENTE`, preservando o modo
local-first. O endpoint de lote recebe `{"events":[...]}` e só deve responder
`2xx` quando aceitar o lote inteiro; cada item inclui `company_id` e
`event_uuid` para isolamento e idempotência.

## Captura imediata

Para a Hikvision DS-2CD2121G0-I, a interface física é RJ45/Ethernet e o protocolo de mídia é RTSP sobre TCP. O worker não mantém o stream aberto nem decodifica imagens em segundo plano. Quando existe um pedido de captura, inicia uma conexão RTSP, solicita um único quadro JPEG, encerra o FFmpeg, monta o PDF no PC industrial e grava esse PDF no armazenamento local antes do envio. A API local recebe e guarda os mesmos bytes do PDF; nenhum JPEG é gravado como arquivo. Sem pedido de captura, nenhuma imagem é processada.

O ciclo automático usa o token do dispositivo CAMERA provisionado para a Dala:

1. Consulta `/api/camera_worker.php` a cada 200 ms e reserva a solicitação pendente mais antiga da própria Dala.
2. Monta e salva um PDF de até 10 MiB em `CAMERA_EVIDENCE_DIR` no PC industrial, incluindo a captura JPEG como imagem e como dado de origem recuperável. Envia o PDF para `/api/camera_upload.php`; a API valida e armazena o PDF recebido sem convertê-lo novamente e devolve `evidence_pdf_path` e seu SHA-256.
3. Confirma a conclusão em `/api/camera_worker.php`. Se o processo reiniciar entre o upload e a confirmação, a reserva expira em 30 segundos: o worker reutiliza o PDF local e, se ele não existir, baixa o PDF armazenado pelo servidor antes de confirmar, sem tirar outra foto.
4. Publica o estado a cada 5 segundos usando uma verificação TCP leve da porta RTSP. Isso confirma que a porta responde, mas as credenciais e a entrega de imagem só ficam confirmadas em uma captura solicitada. Uma falha de captura mantém o pedido na fila para recuperação depois de 30 segundos.

### Preparação única da câmera

1. Alimente a câmera pela entrada de 12 V indicada na etiqueta ou por um equipamento PoE 802.3af. A porta USB-Ethernet do PC transporta dados e não fornece energia à câmera.
2. Ligue a porta RJ45 da câmera a uma interface Ethernet dedicada do PC, de preferência o adaptador USB-Ethernet separado do enlace do CLP. Mantenha a rede da câmera em uma sub-rede privada própria, sem gateway ou acesso à internet; não reutilize o endereço do CLP.
3. Defina um endereço IP privado fixo para câmera e adaptador, na mesma sub-rede. Habilite RTSP, configure o fluxo principal em H.264 a 15 fps e crie um usuário de visualização dedicado com senha forte. Não use a senha administrativa da câmera no sistema.
4. Preencha no `.env` local `CAMERA_RTSP_HOST`, `CAMERA_RTSP_PORT`, `CAMERA_RTSP_CHANNEL`, `CAMERA_RTSP_USERNAME` e `CAMERA_RTSP_PASSWORD`. O canal `101` seleciona o fluxo principal; `102`, o secundário. A porta padrão configurada no Trace é `554`; ajuste-a se a câmera estiver configurada com outra porta.
5. Inicie o PC pelo `TraceLauncher.cmd` ou execute o Compose com o perfil `industrial`. O worker inicia junto do Trace, monitora a porta RTSP sem processar imagens e só abre o stream quando recebe um pedido de foto.

`CAMERA_CAPTURE_TIMEOUT_MS` limita quanto tempo uma captura pontual pode esperar por um quadro (10 s por padrão, máximo de 20 s). `CAMERA_JOB_POLL_MS` controla a fila de solicitações; se não houver foto pendente, o worker não chama o FFmpeg nem abre o RTSP.

O usuário e a senha RTSP são passados ao FFmpeg como parte da URL de entrada e podem ficar visíveis a administradores do PC que consultem os argumentos do processo. Use uma conta dedicada apenas para visualização e restrinja o acesso administrativo ao PC. O `stderr` do FFmpeg não é encaminhado aos logs, pois mensagens de falha podem incluir a URL de conexão; os erros operacionais do worker são registrados sem incluir essa URL.

`CAMERA_JOB_POLL_MS` controla a frequência das consultas da fila (200 ms por padrão, até cinco consultas por segundo quando o worker está ocioso). Aumentar esse intervalo reduz chamadas ao PHP/MySQL, mas pode atrasar a foto do saco; só altere depois de medir a latência de captura com o equipamento instalado.

Se uma consulta à API falhar, o worker aumenta progressivamente a espera até 2 s, respeitando o intervalo configurado como mínimo. O mesmo erro é registrado no máximo uma vez a cada 30 s; após uma resposta bem-sucedida, as consultas voltam ao intervalo configurado.

Se a interface da câmera não tiver sido inicializada, faça essa configuração uma vez com a ferramenta SADP da Hikvision ou pela interface web da câmera, antes de iniciar a operação. A rede precisa permitir que o worker em Docker alcance o endereço configurado; confirme esse caminho na bancada do PC que receberá o adaptador.

Quando o relatório final do romaneio é solicitado, o Trace incorpora as evidências ao relatório PDF e salva esse arquivo em `armazenamento/company_<id>/reports/`. A captura original em PDF permanece no PC industrial e no servidor local até `IMAGE_RETENTION_DAYS`; a rotina de retenção apaga as duas cópias antigas e seus vínculos. O PDF final do relatório permanece no servidor e é reutilizado nos próximos downloads. A sincronização remota de eventos não replica arquivos de evidência para outro Central; neste fluxo, “servidor” significa o servidor local que recebe o PDF da câmera.

O fluxo contínuo evita abrir uma conexão RTSP nova a cada solicitação e reduz a espera inicial. Não existe captura sem atraso: a latência final depende da exposição, codificação da câmera, rede, processamento do PC e geração do PDF. Meça esse tempo com a câmera, adaptador e PC definitivos antes de fixar um limite de aceitação.

## Fila de comandos do CLP

O painel cria uma solicitação local; o gateway é o único componente que escreve no CLP. A aplicação cria uma entrada local em `solicitacoes_comandos_clp` para iniciar, parar, reversão ou emergência. O fluxo do Node-RED/gateway é:

1. `POST ${TRACE_API_URL}/plc_gateway.php` com o token individual da Dala em `X-Device-Token` e `{"action":"CLAIM","equipment_id":N}`;
2. validar o estado permitido, o destino Modbus e a configuração física da instalação;
3. bloquear a escrita se `physical_clp_enabled` não estiver habilitado, o mapa não estiver `APPROVED`, o ID da Dala não corresponder ou algum dos três endereços de saída e o endereço de retorno estiver ausente, inválido ou repetido;
4. após a aprovação, enviar FC5 para a bobina configurada para aquele comando; para liberar a emergência, desligar a bobina de comando configurada e ler por FC1 a bobina de retorno configurada;
5. só retornar `APLICADO` quando o eco da escrita estiver válido e, na liberação, o retorno estiver em 0; se a resposta estiver ausente/inválida ou o retorno continuar 1, retornar `ERRO` e manter a operação bloqueada;
6. retornar `{"action":"COMPLETE","request_id":N,"status":"APLICADO"}` ou `REJEITADO`/`ERRO`, com uma mensagem curta. Somente o mesmo dispositivo que reservou o comando pode concluí-lo.

O `machine.json` guarda o mapa aprovado da instalação e o instalador o envia ao Node-RED. O exemplo inclui o mapa do INVT TS621, mas mantém a escrita física desabilitada até essa opção ser escolhida para a máquina. Cada escrita aprovada usa função 5, unidade Modbus configurada e confirmação por eco. Se o eco ou o retorno forem inválidos ou não chegarem, o pedido termina como `ERRO`; o Trace nunca apresenta `APLICADO` apenas porque abriu uma conexão TCP.

### Intertravamentos de direção

- `Ligar esteira` (frente) só é aceito em `PREPARANDO` ou `PAUSADO`, depois de o gateway confirmar `REVERSAO_DESATIVAR`. Sem confirmação anterior da reversão desligada, o comando é recusado; o operador deve desligar a reversão e aguardar o retorno.
- `Ligar reversão` e `Desligar reversão` só são aceitos com o carregamento parado (`PREPARANDO` ou `PAUSADO`). A API e o gateway verificam a condição antes de enfileirar e antes da escrita.
- `Desligar esteira` permanece disponível como parada normal. `EMERGÊNCIA` tem prioridade na fila, coloca o carregamento em `EMERGENCIA` e solicita a bobina de emergência configurada; início e mudança de direção ficam bloqueados até o procedimento autorizado de liberação.
- O ACK de escrita confirma o eco Modbus da bobina, não a velocidade/direção real do motor. A parada de emergência física e os intertravamentos finais precisam continuar no Ladder/circuito aprovado e ser validados em bancada.
