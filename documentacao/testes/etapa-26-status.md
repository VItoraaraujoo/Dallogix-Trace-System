# Status dos testes — Etapa 26

## STATUS

IMPLEMENTADA — observabilidade da sincronização local-first.

## ENTREGAS

- Novo endpoint autenticado `GET /api/sync_status.php`.
- Resumo por estado da fila: pendente, processando, enviado e erro.
- Lista dos eventos aguardando reprocessamento.
- Painel de sincronização na tela de Alertas.
- Retry manual usando o endpoint já existente `sync_queue.php`.
- O botão fica desabilitado quando não há `SYNC_REMOTE_URL`, preservando a operação offline.

## TESTE

`bash testes/etapa26.sh`
