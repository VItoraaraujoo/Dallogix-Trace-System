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
- reserva comandos pela API, prioriza `EMERGENCIA` e os conclui como `REJEITADO` por padrão enquanto o mapa de I/O estiver como `CONFIRMAR`;
- não executa escrita em bobina, registrador ou saída física;
- não acessa o banco diretamente.

Configure no ambiente do Node-RED:

```text
TRACE_API_URL=http://trace-api.local
TRACE_DEVICE_TOKEN=token-da-dala-deste-pc
TRACE_MODBUS_UNIT_ID=1
TRACE_MODBUS_HEARTBEAT_FUNCTION=1
TRACE_MODBUS_HEARTBEAT_REGISTER=2052
```

Cada PC industrial é dedicado a uma Dala e usa os tokens dos seus próprios gateways. A API devolve somente a Dala vinculada a esse dispositivo e fornece um destino IPv4 privado validado. O endereço da API deve apontar para a instalação local, nunca para a URL pública. Ao cadastrar ou sincronizar a Dala local, o Trace provisiona automaticamente os tokens CLP e CAMERA do `.env`; o comando `php scripts/provision_device.php` fica reservado para recuperação administrativa de uma instalação existente. O instalador já inicia com o perfil seguro informado para o INVT TS621: unidade 1, função 1 (coil) e endereço 2052 (M2052). Para outro CLP, substitua os três valores no `.env`; as funções 1/2 (coils/entradas discretas) e 3/4 (registros) são validadas antes do envio. Os valores `2049` e `2050` continuam sendo comandos e nunca são usados como heartbeat.

O nó `Modbus Read/Write` só deve ser acrescentado depois de confirmar em bancada a variante do Delta DVP14SS, IP, porta, unidade Modbus, registradores, bobinas e intertravamentos do Ladder. A ausência dessas informações é intencionalmente tratada como bloqueio seguro.

Para validar a fila de comandos em uma instalação descartável, habilite somente
nesse `.env` local `TRACE_LOCAL_SIMULATION=1` e
`TRACE_SIMULATOR_ONLY_COMMANDS=1`. O gateway verifica as transições simuladas,
registra a resposta como teste e nunca envia escrita Modbus ou saída física.
`EMERGENCIA` continua rejeitada pelo Trace e deve ser acionada fisicamente. A
validação de produção recusa esses dois flags; não os habilite em uma máquina
de operação.

## Simulação no PC

Para testar a lógica sem CLP, importe também `trace-clp-simulador.flow.json`. Os botões do fluxo simulam iniciar, pausar, emergência, retorno, produto correto, produto incorreto e ausência de leitura. Os resultados aparecem no painel de debug do Node-RED, com `loading_state`, contagem, progresso e evento gerado.

Sequência sugerida: `Resetar` → `Iniciar` → vários `Sensor + produto correto` → `Pausar` → `Retorno`. Depois repita com `Produto incorreto`, `Sensor sem leitura` e `Emergência`. Essa simulação usa somente o contexto do Node-RED e não chama a API nem o CLP real.

O perfil `simulation` sobe um único servidor `modbus-virtual` em `127.0.0.1:1502`. Ele implementa leitura de coils/entradas/registros e escrita de coil/registro em memória, para testes de transporte Modbus TCP. O fluxo operacional `trace-clp-bridge.flow.json` lê o endereço e a porta da Dala cadastrada, sem destino de CLP predefinido. O mapa da simulação está em `integracoes/industrial/register-map.example.json`; ele não deve ser reutilizado como mapa de produção. O perfil padrão de produção usa apenas leitura de M2052 e não libera comandos de saída.

O [contrato provisório de simulação](../industrial/contrato-provisorio-simulacao.md) documenta os limites dessa bancada e os cenários automatizados com `node --test testes/clp-provisorio-simulacao.mjs`. Ele não altera o bloqueio de escritas no gateway físico.

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

Para a Hikvision DS-2CD2121G0-I, a interface física é RJ45/Ethernet e o protocolo de mídia usado aqui é RTSP sobre TCP. O fluxo direto não depende de ONVIF ou ISAPI. No PC industrial, o serviço `camera-worker` mantém uma conexão RTSP com a câmera. O FFmpeg decodifica o fluxo em memória e o worker conserva o JPEG mais recente. Quando chega uma solicitação, esse quadro é enviado ao Trace; o JPEG fica somente em memória/tmpfs durante o processamento e não é retido. A API gera e mantém apenas o PDF de evidência. Nenhum arquivo de vídeo é criado.

O ciclo automático usa o token do dispositivo CAMERA provisionado para a Dala:

1. Consulta `/api/camera_worker.php` a cada 200 ms e reserva a solicitação pendente mais antiga da própria Dala.
2. Envia um JPEG de até 4 MiB para `/api/camera_upload.php`; a API valida a captura, gera o PDF e devolve `evidence_pdf_path`.
3. Confirma a conclusão em `/api/camera_worker.php`. Se o processo reiniciar entre o upload e a confirmação, a reserva expira em 30 segundos e o worker conclui usando o PDF já guardado, sem criar outra foto.
4. Publica o estado da câmera a cada 5 segundos. A indisponibilidade do fluxo RTSP aparece como OFFLINE; a reconexão é automática, com espera crescente limitada a 30 segundos.

### Preparação única da câmera

1. Alimente a câmera pela entrada de 12 V indicada na etiqueta ou por um equipamento PoE 802.3af. A porta USB-Ethernet do PC transporta dados e não fornece energia à câmera.
2. Ligue a porta RJ45 da câmera a uma interface Ethernet dedicada do PC, de preferência o adaptador USB-Ethernet separado do enlace do CLP. Mantenha a rede da câmera em uma sub-rede privada própria, sem gateway ou acesso à internet; não reutilize o endereço do CLP.
3. Defina um endereço IP privado fixo para câmera e adaptador, na mesma sub-rede. Habilite RTSP, configure o fluxo principal em H.264 a 15 fps e crie um usuário de visualização dedicado com senha forte. Não use a senha administrativa da câmera no sistema.
4. Preencha no `.env` local `CAMERA_RTSP_HOST`, `CAMERA_RTSP_PORT`, `CAMERA_RTSP_CHANNEL`, `CAMERA_RTSP_USERNAME` e `CAMERA_RTSP_PASSWORD`. O canal `101` seleciona o fluxo principal; `102`, o secundário. A porta padrão configurada no Trace é `554`; ajuste-a se a câmera estiver configurada com outra porta.
5. Inicie o PC pelo `TraceLauncher.cmd` ou execute o Compose com o perfil `industrial`. O serviço inicia junto do Trace e tenta recuperar o fluxo sem intervenção.

Se a interface da câmera não tiver sido inicializada, faça essa configuração uma vez com a ferramenta SADP da Hikvision ou pela interface web da câmera, antes de iniciar a operação. A rede precisa permitir que o worker em Docker alcance o endereço configurado; confirme esse caminho na bancada do PC que receberá o adaptador.

Quando o relatório final do romaneio é solicitado, o Trace incorpora as evidências ao relatório PDF, salva esse PDF em `armazenamento/company_<id>/reports/` e remove os PDFs intermediários e referências temporárias. O PDF final permanece no servidor e é reutilizado nos próximos downloads. A retenção de evidências intermediárias segue `IMAGE_RETENTION_DAYS` caso o relatório ainda não tenha sido solicitado.

O fluxo contínuo evita abrir uma conexão RTSP nova a cada solicitação e reduz a espera inicial. Não existe captura sem atraso: a latência final depende da exposição, codificação da câmera, rede, processamento do PC e geração do PDF. Meça esse tempo com a câmera, adaptador e PC definitivos antes de fixar um limite de aceitação.

## Fila de comandos do CLP

O painel não escreve diretamente no CLP. Com a esteira pausada, qualquer perfil operacional pode solicitar `REVERSAO_ATIVAR` ou `REVERSAO_DESATIVAR`; a aplicação cria uma entrada local em `plc_command_requests`. O fluxo do Node-RED/gateway é:

1. `POST ${TRACE_API_URL}/plc_gateway.php` com o token individual da Dala em `X-Device-Token` e `{"action":"CLAIM","equipment_id":N}`;
2. validar no CLP que a máquina está pausada, sem emergência e com todos os intertravamentos do Ladder atendidos;
3. enviar o pulso de ativação ou desativação de reversão definido no mapa de I/O aprovado;
4. retornar `{"action":"COMPLETE","request_id":N,"status":"APLICADO"}` ou `REJEITADO`/`ERRO`, com uma mensagem curta. Somente o mesmo dispositivo que reservou o comando pode concluí-lo.

Enquanto o mapa de I/O estiver como `CONFIRMAR`, o gateway pode consumir e responder `REJEITADO`, mas não deve escrever nenhuma bobina ou registrador.
