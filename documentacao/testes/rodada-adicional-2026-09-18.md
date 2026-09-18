# Rodada adicional de testes — Trace

Data: 18/09/2026  
Commit validado: \`57849cb\`  
Ambientes: Trace local (\`http://127.0.0.1:8080\`) e servidor (\`https://trace.santocloud.com.br\`)

## Resultado executivo

A regressão completa terminou com **37 etapas aprovadas e 0 falhas**. O
ambiente de teste temporário foi desligado após a execução; o PHP voltou a
usar CSRF e limite normal de login.

Também foi corrigido um defeito real na importação CSV: as colunas opcionais
\`motorista\` e \`expedidor\` agora podem ser omitidas sem gerar erro de índice.

## Validações executadas

| Área | Esperado | Resultado |
| --- | --- | --- |
| Regressão completa | Todas as etapas existentes passarem | PASS — 37/37 |
| Autenticação e sessão | Login válido, sessão protegida e logout | PASS |
| CSRF | Mutação sem token ser recusada | PASS — HTTP 419 |
| Permissões e isolamento | Perfis e dados restritos à empresa correta | PASS |
| Licença | Bloqueio impedir nova operação e reativação funcionar | PASS |
| Romaneio/carregamento | Preparar, carregar, pausar, emergência e finalizar | PASS |
| Scanner | Leitura só contabilizar em \`CARREGANDO\` | PASS |
| CLP | Heartbeat, leitura válida, leitura incorreta e ausência de sinal | PASS |
| Modbus TCP | Ler/escrever holding register e coil no simulador | PASS |
| Câmera | Solicitar, reservar e concluir captura de incidente | PASS |
| Sincronização | Fila local protegida e retry/endpoint remoto validados | PASS |
| CSV | CSV completo, colunas opcionais, datas e rollback | PASS |
| PDF | Relatório de auditoria gerar PDF válido | PASS |
| Monitoramento/emergência | Estado, desbloqueio e atualização da tela | PASS |
| Qualidade | Sintaxe PHP/JavaScript e referências | PASS |
| Segurança | Busca por credenciais/segredos acidentais | PASS |
| API smoke | Autenticação e entradas principais | PASS |

## Ajustes realizados

- Corrigido o acesso às colunas opcionais na API de importação CSV.
- Tornadas as fixtures da regressão independentes da ordem e do estado
  deixado por outra etapa.
- Incluído intervalo entre etapas para respeitar o limite normal de login do
  Nginx e evitar falsos HTTP 503.
- Atualizada a validação do PDF para funcionar também em máquinas sem
  \`pdfinfo\`, mantendo checagem de cabeçalho, página e EOF.
- Atualizados testes que apontavam para módulos JavaScript e serviço de
  monitoramento que foram reorganizados.
- Ajustado o teste de configurações para respeitar que a URL de sincronização
  remota é definida somente no backend.

## Saúde após os testes

- Health local: \`ok\`, PHP/MySQL disponíveis.
- Health remoto: \`ok\`, no mesmo commit \`81a0fe7c777c978b332aaff2961826d36df5cd25\`
  antes da publicação deste commit.
- Prontidão remota: \`ready\`.
- Fila remota: 26 pendências, 0 em processamento, 0 erros e 0 comandos presos.
- Disco remoto: 56,85% livre.
- O ambiente local voltou a \`TRACE_TESTING_DISABLE_CSRF=0\`,
  \`TRACE_TESTING_DISABLE_LOGIN_RATE_LIMIT=0\` e endpoint de lote remoto
  configurado.

## Limitações

- Não há CLP físico nesta máquina; a comunicação foi exercitada com Modbus TCP
  virtual e com os simuladores de CLP/câmera.
- O teste em Windows 11/CLP real ainda depende do equipamento e da rede
  industrial.
- A fila remota contém eventos de teste pendentes, mas sem erro e dentro do
  limite de prontidão configurado.
