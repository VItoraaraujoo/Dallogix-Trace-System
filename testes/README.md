# Testes do Dallogix Trace

Os testes de regressão legados usam o nome `etapa<N>.sh` porque acompanham a
ordem de entrega original. Antes de alterar uma funcionalidade, consulte o
documento de status correspondente em `documentacao/testes/etapa-<N>-status.md`
e execute o teste da etapa relacionada.

Para testes novos, use nomes descritivos por funcionalidade, por exemplo:

- `api-leituras.sh`
- `api-romaneios.sh`
- `servico-estado-carregamento.php`
- `permissoes-usuarios.sh`

`qualidade.sh` valida a sintaxe e referências essenciais. `regressao_completa.sh`
executa toda a suíte integrada quando os serviços locais estiverem ativos.

As regressões isoladas `gateway-clp.mjs`, `operacoes-offline.mjs`,
`camera-upload-http.mjs` e `modbus-transporte.py` não precisam do banco da
empresa nem acionam CLP físico.
Execute com `node --test testes/gateway-clp.mjs testes/operacoes-offline.mjs testes/camera-upload-http.mjs`
e `python3 testes/modbus-transporte.py`. Os testes PHP isolados são executados
por `composer test`.
As rotas centrais de conectividade e a idempotência do sensor são verificadas
sem tocar no banco real por `api-conectividade-isolada.php` e
`api-sensor-idempotencia-isolada.php`, com os cenários definidos no workflow de
qualidade.
`camera-upload-http.mjs` inicia um servidor PHP temporário e testa upload
multipart e confirmação da câmera em pasta temporária, sem banco ou equipamento real.
