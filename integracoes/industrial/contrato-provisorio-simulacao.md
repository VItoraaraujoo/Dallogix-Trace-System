# Contrato provisório de teste do CLP — somente simulação

Este contrato organiza testes de software até receber o programa Ladder, o mapa de I/O e os dados de comunicação **oficiais da instalação**. Inclui uma fonte IL para criar um programa novo no ISPSoft, mas **não** é um projeto `.isp` compilado, não representa a lógica real do DVP-14SS2 e **não autoriza download em CLP físico nem operação da máquina**.

## Programa executável no simulador Delta

O arquivo [`clp-provisorio-ss2.il`](./clp-provisorio-ss2.il) contém instruções básicas do DVP-SS2 (`LD`, `AND`, `ANI`, `OR`, `OUT`, `END`) para colar em um programa **Instruction List (IL)** novo no ISPSoft. Usa exclusivamente relés internos `M`: não lê entradas elétricas `X`, não aciona saídas `Y` e não possui endereço Modbus. É uma bancada de permissões, **não** um controle de motor, um circuito de emergência ou um substituto do Ladder oficial.

| Bit de entrada | Significado apenas no teste | Valor inicial |
| --- | --- | --- |
| `M10` | Solicitação de partida | 0 |
| `M11` | Estado pausado | 0 |
| `M12` | Emergência indicada | 0 |
| `M13` | Limite/intertravamento indicado | 0 |
| `M14` | Comunicação indicada como válida | 0; colocar em 1 manualmente para autorizar o teste |
| `M20` | Solicitação de reversão | 0 |

| Bit de resultado | Interpretação na bancada |
| --- | --- |
| `M100` | Partida permitida: solicitação, não pausado, sem emergência/limite e comunicação válida |
| `M101` | Reversão permitida: solicitação, pausado, sem emergência/limite e comunicação válida |
| `M102` | Partida solicitada com emergência indicada |
| `M103` | Reversão solicitada sem pausa |
| `M104` | Algum comando solicitado sem comunicação válida |

### Na VM Windows

1. Instale ISPSoft e COMMGR da Delta; mantenha a VM isolada da rede da máquina/CLP físico.
2. Crie um **projeto novo de teste** para a família DVP/SS2 e um programa do tipo **IL** na tarefa cíclica. Não abra nem substitua um projeto operacional existente.
3. Abra `clp-provisorio-ss2.il` no editor de texto, copie apenas as instruções e cole no editor IL. Compile. Se a versão do ISPSoft rejeitar alguma linha, registre a mensagem exata: este arquivo ainda não foi compilado no ISPSoft aqui.
4. No COMMGR, selecione `DVP Simulator` com dispositivo `SS2`, inicie o driver, escolha-o nas configurações de comunicação do ISPSoft, faça download **somente para o simulador** e coloque-o em `RUN`.
5. No monitor de dispositivos, altere manualmente `M10`, `M11`, `M12`, `M13`, `M14` e `M20`; observe `M100` a `M104`. Comece com tudo em 0, ative `M14` e execute os casos abaixo.

| Caso | Entradas em 1 (demais em 0) | Resultado esperado |
| --- | --- | --- |
| Partida liberada | `M10`, `M14` | `M100=1`, `M101=0` |
| Pausa bloqueia partida | `M10`, `M11`, `M14` | `M100=0` |
| Reversão liberada na pausa | `M11`, `M14`, `M20` | `M101=1`, `M100=0` |
| Reversão sem pausa | `M14`, `M20` | `M101=0`, `M103=1` |
| Emergência indicada | `M10`, `M12`, `M14` | `M100=0`, `M102=1` |
| Limite indicado | `M10`, `M13`, `M14` | `M100=0` |
| Comunicação indicada como perdida | `M10` | `M100=0`, `M104=1` |

Execute também `node --test testes/clp-provisorio-ss2.mjs`: esse teste local interpreta o subconjunto de IL usado no arquivo e verifica as 64 combinações possíveis das seis entradas. **Ele não substitui a compilação e a execução no ISPSoft.** Os bits `M` deste programa não são os endereços do servidor Modbus Docker nem os bits do CLP de produção.

## O que existe hoje

| Camada | O que pode ser observado | Limite |
| --- | --- | --- |
| `trace-clp-simulador.flow.json` | Estados e eventos de iniciar, pausar, emergência, leitura correta/incorreta, ausência de leitura e retorno | Lógica de referência em Node-RED; não executa Ladder nem Modbus |
| `modbus-virtual` | Leituras e escritas Modbus TCP em memória | Não executa intertravamentos, sensores ou saídas Delta |
| `register-map.example.json` | Endereços **somente da simulação local** | Campos físicos seguem `CONFIRMAR`; não copiar para produção |
| `trace-clp-bridge.flow.json` | Leitura de saúde Modbus e fila de comandos | Rejeita comandos enquanto o mapa físico não estiver aprovado; não escreve no CLP |

Na simulação local, `127.0.0.1:1502` expõe `sack_sensor` como entrada discreta 0, `emergency_active` como entrada discreta 1, `conveyor_running` como bobina 0, `reverse_command` como bobina 1 e `loaded_quantity` como registrador de retenção 0. Esses números são **convenções de teste**, não endereços Delta. O servidor virtual não permite escrever nas entradas discretas; os botões do fluxo Node-RED simulam eventos separadamente.

## Cenários automatizados agora

Execute `node --test testes/clp-provisorio-simulacao.mjs` na raiz do repositório. O teste lê o motor real do fluxo Node-RED, executa as ações em memória e verifica:

1. partida e contagem somente no estado de carregamento;
2. pausa após produto incorreto ou ausência de leitura;
3. emergência impedindo reinício e novas leituras válidas;
4. retorno somente quando pausado e com quantidade carregada;
5. limite da quantidade planejada;
6. permanência dos endereços físicos como `CONFIRMAR`.

Para validar separadamente o transporte Modbus do container de simulação, use `python3 scripts/test_modbus_virtual.py` com o perfil `simulation` ativo. Esse teste escreve apenas no servidor virtual local e lê os valores de volta; **não** testa os cenários do Node-RED ou o Ladder.

`RESET` no fluxo Node-RED limpa o estado de emergência **apenas na simulação de software**. Isso não é uma especificação de rearme físico: o procedimento real e os intertravamentos devem ser definidos e aprovados pelo responsável técnico.

## Hipóteses ainda não validadas

- O diagrama externo sugere DVP-14SS2, expansões, emergência e fins de curso, mas não confirma o painel da instalação atual nem a tabela Modbus.
- O comportamento real de partida, parada, reversão, emergência, temporizadores e falha de comunicação depende do Ladder oficial e do circuito elétrico.
- Não está demonstrado que o simulador ISPSoft/COMMGR aceite uma conexão Modbus TCP externa do Trace; essa possibilidade precisa de teste próprio em ambiente Windows.
- A simulação não prova tempos de varredura, polaridade elétrica, atuação de relés, parada de emergência ou resposta de inversores.
- O programa IL de bancada calcula permissões instantâneas; não possui retenção, rearme de emergência, temporizadores ou saídas físicas. Esses comportamentos dependem da especificação e do programa oficial.

## Quando chegar o material oficial

1. Registrar versão do projeto Ladder, modelo completo do CLP, expansões e módulo de comunicação.
2. Comparar cada sinal deste contrato com o desenho elétrico e o endereço/função Modbus oficiais; manter os endereços de simulação isolados.
3. Testar os cenários no simulador Delta com o Ladder **real** e acrescentar os casos que ele exigir, especialmente intertravamentos e perda de comunicação.
4. Verificar em bancada o comportamento do CLP físico e dos circuitos de segurança com profissional habilitado antes de autorizar qualquer escrita operacional.
5. Somente após essa aprovação, criar um mapa de produção separado e revisar o gateway; não substituir silenciosamente os campos `CONFIRMAR` do exemplo.

## Referências da Delta

- [Manual de programação DVP-SS2](https://filecenter.deltaww.com/Products/download/06/060302/Manual/DELTA_IA-PLC_DVP-ES2-EX2-EC5-SS2-SA2-SX2-SE-SE2-TP_PM_EN_20241031.pdf): lista de instruções, relés internos `M0` a `M511` e instrução `END`.
- [Manual do ISPSoft](https://filecenter.deltaww.com/Products/download/06/060302/Manual/DELTA_IA-PLC_ISPSoft_UM_EN_20210329.pdf): edição em IL e configuração `DVP Simulator`/`SS2` no COMMGR.
- [Limitações do simulador](https://www.deltaww.com/en-US/service-support/faq/332): a simulação não reproduz integralmente o CLP físico.
