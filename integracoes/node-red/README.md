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

Cada PC industrial é dedicado a uma Dala e usa os tokens dos seus próprios gateways. A API devolve somente a Dala vinculada a esse dispositivo e fornece um destino IPv4 privado validado. O endereço da API deve apontar para a instalação local, nunca para a URL pública. Ao cadastrar ou sincronizar a Dala local, o Trace provisiona automaticamente os tokens CLP e SCANNER do `.env`; o comando `php scripts/provision_device.php` fica reservado para recuperação administrativa de uma instalação existente. O heartbeat usa unidade, função e endereço configurados no ambiente. O gateway só publica ONLINE depois de uma resposta Modbus válida; IP e porta continuam vindo do cadastro da Dala.

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

O KEYENCE SR-X100W envia o código diretamente ao `keyence-worker` por TCP. O worker associa os quadros em sequência aos eventos pendentes mais antigos da mesma Dala e envia o resultado para `/api/leituras.php`, autenticado como `SCANNER`. Um código recebido depois da passagem ainda pode ser associado dentro de `TRACE_SCANNER_NO_READ_TIMEOUT_MS` (padrão 1500 ms), sem ocupar uma passagem que já venceu. Se o prazo expirar sem código, o gateway registra `SEM_LEITURA` e solicita a imagem de erro do Keyence; a API serializa a leitura e o timeout por carregamento para que o mesmo evento não gere dois resultados. O POST do evento repete até três vezes com o mesmo identificador em falhas temporárias, sem duplicar registros. Configure o SR-X em `Timing Mode = Standard` com um pulso por passagem; em `Continuous`, quadros repetidos podem ser associados às próximas sacas e o software não consegue distingui-los de sacas legítimas com códigos iguais.

## Heartbeat dos dispositivos

O gateway verifica e publica o heartbeat do CLP a cada **1 segundo**. A leitura do sensor M2052 ocorre a cada **200 ms**; o status `SENSOR` só fica ONLINE após uma resposta Modbus válida e passa a OFFLINE quando a comunicação falha. O Keyence publica seu próprio heartbeat como `SCANNER`, incluindo a situação dos serviços TCP e FTP. Eventos de passagem usam somente leitura FC1 e não enviam escrita ao CLP. O timeout de leitura consulta o servidor local uma vez por segundo enquanto há carregamento ativo, para retomar passagens pendentes após reinício do Node-RED.

## Sincronização remota

O servidor mantém eventos em `fila_sincronizacao`. O processamento envia dados
quando `SYNC_REMOTE_URL` ou `SYNC_REMOTE_BATCH_URL` estiver configurada no `.env`;
sem essas variáveis, os eventos permanecem `PENDENTE`, preservando o modo
local-first. O endpoint de lote recebe `{"events":[...]}` e só deve responder
`2xx` quando aceitar o lote inteiro; cada item inclui `company_id` e
`event_uuid` para isolamento e idempotência.

## Imagens de erro do Keyence

O `keyence-worker` recebe o JPEG pelo FTP passivo do SR-X100W e grava temporariamente em `armazenamento/keyence-inbox`. Quando encontra uma única solicitação `SEM_LEITURA` compatível, envia a imagem à API local, que a valida e vincula ao evento. O PDF final incorpora as imagens de falha; os arquivos fonte só são removidos depois que o relatório estiver salvo. Uma imagem sem associação segura expira sem ser atribuída a outra saca. Veja portas, IPs e opções do leitor no [guia do KEYENCE SR-X100W](../../documentacao/operacao/preparacao-keyence-sr-x100w.md).

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
