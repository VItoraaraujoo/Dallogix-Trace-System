# Auditoria completa — Dallogix Trace

Data: 18/09/2026  
Ambientes: Trace local (`http://localhost:8080`) e servidor de teste (`https://trace.santocloud.com.br`)  
Escopo: aplicação web, APIs, banco, sincronização, Node-RED, Modbus virtual, segurança, interface, operação e deploy.

## 1. Resultado executivo

O núcleo funcional passou pela regressão completa: **37 de 37 etapas aprovadas**.
Também passaram os testes de qualidade, security scan, permissões isoladas,
navegação, API smoke, backup com checksum e Modbus TCP virtual.

Durante a auditoria foram encontrados e corrigidos três problemas comprovados:

1. a reserva de sincronização usava `created_at` sem o alias da tabela, causando
   erro SQL a cada ciclo do worker;
2. o compose subia o Node-RED com o `Flow 1` vazio e não carregava o fluxo CLP
   versionado no repositório;
3. três testes da suíte estavam frágeis/desatualizados: consulta de CSV sem
   filtro de página, extração ambígua do ID da fila e mock de autorização sem a
   consulta de empresa introduzida pelo código atual.

Após as correções, o worker voltou a enviar lotes sem erro, o fluxo CLP foi
carregado no Node-RED real e todos os 37 testes passaram.

Isso **não equivale à homologação de um CLP físico**. A entrada em produção
industrial continua bloqueada até confirmar em bancada o modelo, o módulo de
comunicação, o mapa Modbus/I/O e os intertravamentos do equipamento real.

## 2. Mapeamento inicial

### Módulos

- Frontend SPA com shell compartilhado em `interface/js/aplicacao.js`.
- Autenticação, sessão, CSRF, RBAC, licenças, ativação local e sincronização.
- Cadastro e operação de empresas, usuários, produtos, Dalas, romaneios,
  carregamentos, leituras, ocorrências, retornos e relatórios.
- Fila local-first (`fila_sincronizacao`) e worker em lote.
- Auditoria, logs de erro, retenção, backup e prontidão operacional.
- Gateway CLP, câmera, heartbeat de dispositivos e comandos de reversão.
- Node-RED e simulador Modbus TCP.

### Telas encontradas

`index`, `dashboard`, `manifests`, `manifest`, `manifest-edit`, `work`,
`summary`, `history`, `products`, `dalas`, `dala`, `dala-edit`, `dala-actions`,
`occurrences`, `emergency`, `settings`, `import`, `error-logs`, `alerts`,
`division`, `companies`, `company`, `users` e `master-home`.

### APIs e serviços

- 49 endpoints PHP em `servidor/api`.
- Nginx, PHP-FPM, MySQL 8.4, worker de sincronização, retenção de dados,
  Node-RED e `modbus-virtual` no Compose.
- Integrações externas configuráveis: servidor central, CLP/gateway, câmera,
  scanner e endpoint de sincronização em lote.

### Fluxos críticos

Login → empresa → usuário → Dala → produto → romaneio → carregamento →
leitura/scanner → ocorrência/câmera → encerramento → auditoria → fila local →
sincronização remota.

## 3. Testes funcionais

| Área | Esperado | Resultado |
| --- | --- | --- |
| Regressão completa | Todas as etapas existentes aprovadas | **PASS — 37/37** |
| Login válido, inválido e logout | Sessão criada, senha inválida recusada e logout encerra acesso | **PASS** |
| Sessão sem autenticação | APIs protegidas retornam 401 | **PASS** |
| CSRF | Mutação sem token é recusada | **PASS — HTTP 419** |
| RBAC | Master, administrador, supervisor e usuário respeitam permissões | **PASS** |
| Isolamento por empresa | Usuário não acessa empresa/Dala de outra empresa | **PASS** |
| Empresas | Criar, renomear, arquivar, restaurar e excluir com regra de dependências | **PASS** |
| Licenciamento | Bloquear impede nova operação e reativação restaura | **PASS** |
| Produtos e códigos | Cadastro, edição, listagem e catálogo protegido | **PASS** |
| Romaneios | Criar, editar, listar, filtrar, duplicidade e cancelamento | **PASS** |
| CSV | Importar, datas brasileiras, campos opcionais, repetição de produto e rollback | **PASS** |
| Carregamento | Preparar, iniciar, pausar, emergência, retorno e finalizar | **PASS** |
| Leituras | Válida, incorreta, sem leitura, idempotência e estado inválido | **PASS** |
| Scanner | Só contabiliza leitura quando a esteira está em CARREGANDO | **PASS** |
| Ocorrências | Criar, listar, vincular ao carregamento e refletir no monitoramento | **PASS** |
| Relatórios/PDF | Resumo, filtros, auditoria e PDF válido | **PASS** |
| Fila/retry | Consulta autenticada e retry manual | **PASS** |
| Comandos CLP | Indisponibilidade bloqueia comando; reversão segura registrada | **PASS** |
| Dados inválidos | JSON inválido 400, status inválido 422, método proibido 405 | **PASS** |
| Concorrência | Reserva com transação, `FOR UPDATE` e `SKIP LOCKED` | **PASS estático + funcional** |

### Ajustes na suíte durante a auditoria

- `testes/etapa11.sh` passou a consultar o romaneio importado pelo número,
  evitando falso negativo quando a paginação já possui mais de 50 registros.
- `testes/etapa13.sh` passou a selecionar o primeiro evento realmente
  pendente pelo JSON e aceita tanto o modo offline quanto o envio em lote
  configurado.
- `testes/api-permissoes-isoladas.php` passou a simular a consulta de empresa
  exigida pelo fluxo atual de alteração de usuário.

Na regressão, CSRF e limite de login foram desativados apenas nos containers
de teste e restaurados para `0` imediatamente ao final. O worker foi pausado
durante a suíte para que o teste de retry não disputasse a mesma pendência;
depois foi reativado e confirmou envio normal.

## 4. Integrações CLP, câmera, scanner, Node-RED e Modbus

| Teste | Esperado | Resultado |
| --- | --- | --- |
| Modbus TCP virtual | Ler/escrever holding register e coil | **PASS** — `scripts/test_modbus_virtual.py` |
| Node-RED HTTP | Serviço responder em `127.0.0.1:1880` | **PASS** |
| Fluxo CLP real carregado | `trace-clp-bridge` aparecer no runtime | **PASS após correção** |
| Heartbeat CLP | Atualizar `last_seen_at` da Dala | **PASS** — heartbeat do CLP voltou a atualizar |
| Gate de escrita | Não escrever sem mapa I/O aprovado | **PASS estático** — fluxo retorna REJEITADO |
| Simulação de CLP | Sequências normal, incorreta, pausa e emergência | **PASS** |
| Câmera física | Capturar e concluir imagem real | **NÃO TESTÁVEL** sem câmera/protocolo |
| Scanner físico | Ler dispositivo Elgin real | **NÃO TESTÁVEL** sem scanner conectado |
| CLP Delta físico | Comunicação e endereços reais | **NÃO TESTÁVEL** sem equipamento e mapa homologado |

### Correção do Node-RED

O volume local continha apenas o `Flow 1` vazio, embora o repositório tivesse
o fluxo de referência. O Compose agora usa
`integracoes/node-red/entrypoint.sh`: ele substitui somente o placeholder
vazio pelo fluxo CLP e preserva fluxos já configurados pelo operador. Os
fluxos de simulação continuam sendo importados manualmente.

## 5. Erros e exceções

- Foi corrigido o erro SQL `Column 'created_at' in field list is ambiguous` em
  `ServicoSincronizacao::reserveBatch()`; as colunas agora usam `q.created_at`
  e aliases explícitos.
- Antes da correção, foram registrados 8.645 eventos históricos desse erro,
  concentrados na execução anterior do worker. Depois da correção, não houve
  nova ocorrência; o worker registrou lotes `enviados` sem falhas.
- Foram encontrados quatro registros antigos de `Undefined variable $pdo` em
  `carregamentos.php`, todos de 17/09, antes da correção que inicializou a
  conexão. Não houve ocorrência nas últimas 24 horas.
- O log retém histórico de testes; a existência desses registros antigos não
  significa que o erro continua ativo.
- Backup local gerado com aproximadamente 2,8 MB; checksum e marcador final
  do `mysqldump` conferidos com sucesso.

## 6. Revisão do backend e banco

### Resultado

- Sintaxe PHP completa: **PASS**.
- Avaliação profissional dos helpers de sessão, banco, autorização, auditoria
  e log: **PASS**.
- API smoke: **PASS**.
- PHPStan/PHPUnit local: **NÃO EXECUTADOS** porque Composer e os binários
  `vendor/bin/phpunit`/`vendor/bin/phpstan` não estão instalados neste checkout.
  Os workflows do GitHub instalam e executam essas ferramentas.
- Banco local: 30 tabelas e 143 índices contabilizados.
- `EXPLAIN` da fila usou os índices de status/disponibilidade e empresa; o
  plano do romaneio está adequado ao volume atual, mas usa filesort e deve ser
  reavaliado quando a base crescer significativamente.

### Divergência de migrations

O banco local terminou com 39 registros em `schema_migrations`, enquanto o
endpoint remoto de prontidão informa 40. Os arquivos versionados no checkout
terminam em `039`; o servidor mantém uma migration histórica adicional que não
está presente no repositório atual. Não houve falha funcional observada, mas a
paridade de histórico deve ser reconciliada antes de uma nova promoção de
produção.

## 7. Revisão do frontend

- `testes/qualidade.sh`: sintaxe dos módulos JavaScript e precache: **PASS**.
- Navegação isolada e IDs obrigatórios: **PASS**.
- Cache versionado do app/service worker: **PASS**.
- Telas principais, filtros, criação/edição, estados, ações de emergência,
  exportação e mensagens de erro foram cobertos pela regressão e pelas
  verificações de navegação.
- A tela de login Master preserva o domínio `.local`; empresas usam domínio
  próprio derivado do nome, conforme o fluxo validado anteriormente.
- Não foi afirmado um teste visual perfeito de cada combinação de resolução;
  a validação de layout móvel foi complementar e não substitui homologação
  com usuários de campo.

## 8. Segurança

| Controle | Resultado |
| --- | --- |
| CSP, X-Frame-Options, nosniff e Referrer-Policy | **PASS** |
| Cookies HttpOnly, SameSite e sessão estrita | **PASS** |
| CSRF em mutações | **PASS** |
| Token de dispositivo ausente | **PASS — 401** |
| Query de status com tentativa de injeção | **PASS — 422** |
| JSON malformado | **PASS — 400** |
| Security scan de segredos | **PASS** |
| Isolamento de empresa e dispositivo | **PASS** |
| Rate limit Nginx | **PASS** — em 120 requisições concorrentes de health, 82 foram 200 e 38 foram 429 |

Os 429 são o comportamento esperado do limitador, não uma falha de aplicação.
Os testes não incluíram pentest externo, exploração autenticada completa nem
varredura de vulnerabilidades em rede pública.

## 9. Performance e escalabilidade

- Health local, em amostra curta: aproximadamente 0,0007–0,002 s por chamada.
- 120 chamadas concorrentes confirmaram contenção por rate limit.
- Worker processou lotes de até 50 eventos e confirmou envio sem falhas após a
  correção SQL.
- O banco mantém índices específicos para fila, empresa, data, usuário e
  monitoramento.
- Não foi executado teste de carga prolongado com milhares de usuários, nem
  medição representativa do servidor público; os números locais não devem ser
  usados como SLA.

## 10. Carregamento e operação offline

- Health local respondeu `ok` para PHP/MySQL.
- Prontidão local ficou `degraded` quando a câmera de fixture estava sem
  heartbeat; o CLP passou a enviar heartbeat após o fluxo Node-RED ser
  carregado.
- O servidor remoto respondeu `ready`, com PHP/MySQL disponíveis, 0 comandos
  travados, 0 erros na fila, aproximadamente 56,82% de disco livre e 26
  eventos pendentes dentro do limite de idade configurado.
- A fila local-first permanece disponível quando não há endpoint remoto; com o
  endpoint em lote configurado, o worker envia e marca eventos como ENVIADO.

## 11. Mobile e responsividade

- CSS possui regras para telas estreitas, grids empilhados, tabelas com
  overflow controlado e controles de toque.
- Dashboard, histórico, formulários e menu foram validados na navegação isolada
  e na inspeção de layout existente.
- **PASS funcional**, com ressalva: não foi executada uma matriz automatizada
  completa em dispositivos físicos de 390×844, tablet e orientação paisagem.

## 12. Telas e UX

As telas de operação e Master cobertas foram: dashboard, romaneios,
detalhes/edição, trabalho, resumo, histórico, produtos, Dalas, ocorrências,
emergência, configurações, importação, logs, alertas, empresas, empresa e
usuários.

Resultado: **PASS nos fluxos e controles principais**. Botões destrutivos foram
testados pelas regras de confirmação/API em fixtures; não foram disparadas
ações destrutivas contra dados reais do servidor.

## 13. Navegadores

- Chrome local: **PASS** na navegação e no carregamento das telas.
- Firefox, Edge e Safari: **NÃO TESTADOS** nesta máquina/rodada.
- Compatibilidade declarada apenas por APIs web padrão, CSS e validação
  estática; é necessária uma rodada manual nesses motores antes do go-live.

## 14. Deploy e infraestrutura

- `docker compose config`: **PASS**.
- Containers locais: MySQL, PHP, Nginx, worker, Node-RED e Modbus virtual
  ativos; Node-RED e Modbus saudáveis.
- Pré-requisitos de instalação física: **PASS**.
- Backup/checksum: **PASS**.
- Atualizador remoto possui assinatura/manifesto, backup, migrations,
  healthcheck e rollback documentados.

### Risco operacional encontrado

`.github/workflows/deploy-test.yml` dispara em qualquer push para `master`, mas
não possui `needs` nem mecanismo de `workflow_run` que aguarde os workflows
separados de qualidade e segurança. Portanto, o código do workflow não garante
sozinho a afirmação da documentação de que o deploy só ocorre após esses
checks. Isso deve ser protegido por regras obrigatórias do GitHub ou por uma
etapa de gate dentro do próprio workflow antes de considerar o pipeline
homologado.

## 15. Tabela final de achados

| Prioridade | Achado | Estado | Ação |
| --- | --- | --- | --- |
| P0 operacional | Mapa Modbus/I/O e CLP físico não homologados | Aberto por dependência externa | Confirmar em bancada antes de liberar escrita física |
| P1 | Deploy de teste não está acoplado por código aos workflows de qualidade/segurança | Aberto | Exigir checks na proteção de `master` ou criar gate único |
| P2 | Histórico de migrations local/remoto diverge: 39 × 40 | Aberto | Identificar e versionar/reconciliar a migration histórica |
| P2 ambiental | Prontidão local degrada com câmera sem heartbeat | Esperado no fixture, deve ser tratado no go-live | Provisionar câmera/worker e validar heartbeat real |
| P2 | PHPUnit/PHPStan ausentes no checkout local | Limitação de execução | Rodar no CI ou instalar dependências para auditoria local |
| P3 resolvido | `created_at` ambíguo no worker de sincronização | Corrigido | Manter teste de fila e monitorar novos logs |
| P3 resolvido | Node-RED iniciava com fluxo vazio | Corrigido | Entrypoint carrega seed somente sobre placeholder |
| P3 resolvido | Testes frágeis de paginação, fila e mock | Corrigido | Suíte passou 37/37 após ajustes |

## 16. Top 5 riscos antes do go-live

1. Liberar escrita no CLP sem mapa e intertravamentos confirmados.
2. Permitir deploy automático sem gate obrigatório de qualidade/segurança.
3. Deixar a divergência de migrations sem reconciliação documentada.
4. Instalar o PC industrial sem provisionar heartbeat da câmera e token próprio.
5. Considerar os testes locais de carga e navegador como evidência de produção.

## 17. Conclusão

O software, os fluxos de negócio, a fila, as permissões e a simulação Modbus
estão em condição funcional para continuar a homologação. A suíte automatizada
está verde após a correção dos problemas encontrados. A entrega ainda deve ser
classificada como **aprovada para ambiente de teste e bancada**, não como
aprovada para acionamento industrial real, até fechar os cinco riscos listados
acima.
