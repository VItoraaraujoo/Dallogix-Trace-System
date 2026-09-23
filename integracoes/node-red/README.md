# Node-RED local

## Fluxo de referência

O arquivo `trace-clp-bridge.flow.json` pode ser importado no Node-RED local. Ele contém somente nós nativos e começa em modo seguro:

No `docker compose` do projeto, esse fluxo de referência é carregado
automaticamente quando o volume do Node-RED ainda contém apenas o `Flow 1`
vazio criado pela imagem. Um fluxo já configurado pelo operador é preservado;
os fluxos de simulação continuam sendo importados manualmente quando
necessário.

- testa uma leitura Modbus TCP do CLP e só publica `ONLINE` quando a resposta é válida;
- publica `OFFLINE` quando o CLP não responde, o endereço/porta são inválidos ou a resposta Modbus é inválida;
- consulta a fila de comandos a cada 2 segundos;
- reserva comandos pela API, prioriza `EMERGENCIA` e os conclui como `REJEITADO` enquanto o mapa de I/O estiver como `CONFIRMAR`;
- não executa escrita em bobina, registrador ou saída física;
- não acessa o banco diretamente.

Configure no ambiente do Node-RED:

```text
TRACE_API_URL=http://trace-api.local
TRACE_DEVICE_TOKEN=token-da-dala-deste-pc
TRACE_MODBUS_UNIT_ID=unidade-confirmada
TRACE_MODBUS_HEARTBEAT_FUNCTION=funcao-confirmada-3-ou-4
TRACE_MODBUS_HEARTBEAT_REGISTER=registrador-confirmado
```

Cada PC industrial é dedicado a uma Dala e usa o token do seu próprio gateway. A API devolve somente a Dala vinculada a esse dispositivo e fornece um destino IPv4 privado validado. O endereço da API deve apontar para a instalação local, nunca para a URL pública. Provisione o token com `php scripts/provision_device.php`. A unidade, função e registrador de diagnóstico devem ser confirmados no mapa do CLP; sem os três valores a sonda permanece desabilitada. Os valores `2049` e `2050` dos fluxos de teste não são mapa oficial de I/O.

O nó `Modbus Read/Write` só deve ser acrescentado depois de confirmar em bancada a variante do Delta DVP14SS, IP, porta, unidade Modbus, registradores, bobinas e intertravamentos do Ladder. A ausência dessas informações é intencionalmente tratada como bloqueio seguro.

## Simulação no PC

Para testar a lógica sem CLP, importe também `trace-clp-simulador.flow.json`. Os botões do fluxo simulam iniciar, pausar, emergência, retorno, produto correto, produto incorreto e ausência de leitura. Os resultados aparecem no painel de debug do Node-RED, com `loading_state`, contagem, progresso e evento gerado.

Sequência sugerida: `Resetar` → `Iniciar` → vários `Sensor + produto correto` → `Pausar` → `Retorno`. Depois repita com `Produto incorreto`, `Sensor sem leitura` e `Emergência`. Essa simulação usa somente o contexto do Node-RED e não chama a API nem o CLP real.

O perfil `simulation` sobe um único servidor `modbus-virtual` em `127.0.0.1:1502`. Ele implementa leitura de coils/entradas/registros e escrita de coil/registro em memória, para testes de transporte Modbus TCP. O fluxo operacional `trace-clp-bridge.flow.json` lê o endereço e a porta da Dala cadastrada, sem destino de CLP predefinido. O mapa da simulação está em `integracoes/industrial/register-map.example.json`; ele não deve ser reutilizado como mapa de produção.

## Referência elétrica recebida

O diagrama externo `I-007-00017` confirma a identificação Delta DVP-14SS2 e apresenta sinais candidatos de emergência, fins de curso e comandos. A leitura foi organizada em `mapa-io-candidato.md`, mas o documento não deve ser tratado como mapa Modbus da instalação atual: ele não confirma o painel, o módulo Ethernet nem os endereços de comunicação. A validação em bancada continua obrigatória.

Integração industrial preparada para o Delta DVP14SS. A variante exata, o mapa de registradores e o módulo Ethernet ainda precisam ser confirmados em bancada. A referência principal é **Modbus TCP por Ethernet**; Modbus RTU por RS-485 é somente alternativa caso a instalação não disponha de Ethernet.

O scanner Elgin EL8600 ficará conectado ao PC industrial em USB ou RS-232 e permanecerá em leitura contínua. O adaptador deverá manter um buffer das leituras e associá-las ao evento do sensor recebido do CLP. Se o evento não receber código dentro da janela operacional definida, o servidor registra `SEM_LEITURA` e solicita a captura imediata da câmera.

## Heartbeat dos dispositivos

O gateway deve testar a leitura Modbus e publicar a cada **1 segundo** em `/api/device_heartbeat.php`, usando o token da Dala deste PC: `X-Device-Token: ${TRACE_DEVICE_TOKEN}`. Se não houver resposta válida por mais de 3,5 segundos, o fluxo publica `OFFLINE`; a API bloqueia novos comandos operacionais após o limite de sinal configurado. O fluxo tenta restabelecer a comunicação a cada ciclo de 1 segundo. Isso alimenta o monitoramento local; não habilita comandos físicos por si só.

## Sincronização remota

O servidor mantém eventos em `fila_sincronizacao`. O processamento envia dados
quando `SYNC_REMOTE_URL` ou `SYNC_REMOTE_BATCH_URL` estiver configurada no `.env`;
sem essas variáveis, os eventos permanecem `PENDENTE`, preservando o modo
local-first. O endpoint de lote recebe `{"events":[...]}` e só deve responder
`2xx` quando aceitar o lote inteiro; cada item inclui `company_id` e
`event_uuid` para isolamento e idempotência.

## Captura imediata

O worker deverá chamar `/api/camera_worker.php` com `X-Device-Token` igual ao token do dispositivo de câmera provisionado:

1. `POST {"action":"CLAIM"}` para reservar a próxima captura da própria Dala;
2. disparar a câmera conforme o protocolo confirmado;
3. enviar o JPEG ou PNG real, de até 5 MB, em `POST /api/camera_upload.php` com `multipart/form-data`, campos `request_id` e `file`, e o mesmo token de câmera. A API devolve `image_path` e SHA-256;
4. `POST {"action":"COMPLETE","request_id":N,"image_path":"<caminho retornado>"}`. A conclusão só é aceita se o arquivo enviado existir, corresponder à solicitação reservada e estiver na pasta da empresa/Dala correta.

O protocolo de acionamento da câmera ainda precisa ser confirmado com o fabricante e o worker físico não está implementado. O contrato de upload não substitui a captura física; o servidor não considera uma captura concluída sem arquivo válido e callback `COMPLETE`.

## Fila de comandos do CLP

O painel não escreve diretamente no CLP. Com a esteira pausada, qualquer perfil operacional pode solicitar `REVERSAO_ATIVAR` ou `REVERSAO_DESATIVAR`; a aplicação cria uma entrada local em `plc_command_requests`. O fluxo do Node-RED/gateway é:

1. `POST ${TRACE_API_URL}/plc_gateway.php` com o token individual da Dala em `X-Device-Token` e `{"action":"CLAIM","equipment_id":N}`;
2. validar no CLP que a máquina está pausada, sem emergência e com todos os intertravamentos do Ladder atendidos;
3. enviar o pulso de ativação ou desativação de reversão definido no mapa de I/O aprovado;
4. retornar `{"action":"COMPLETE","request_id":N,"status":"APLICADO"}` ou `REJEITADO`/`ERRO`, com uma mensagem curta. Somente o mesmo dispositivo que reservou o comando pode concluí-lo.

Enquanto o mapa de I/O estiver como `CONFIRMAR`, o gateway pode consumir e responder `REJEITADO`, mas não deve escrever nenhuma bobina ou registrador.
