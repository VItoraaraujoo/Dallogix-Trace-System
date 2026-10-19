# Revisão de código — desempenho e manutenção

Data: 2026-08-31

## Resultado

O sistema está funcional e a suíte atual foi aprovada. A revisão priorizou os caminhos de maior frequência: dashboard, monitoramento, tela de trabalho e consultas por empresa.

## Achados priorizados

### P1 — consultas agregadas repetidas

`servidor/api/monitoramento.php` e `servidor/api/empresas.php` usam subconsultas correlacionadas para obter o último carregamento, o total planejado e as leituras válidas por Dala. Em bases pequenas isso é adequado, mas o custo cresce com o número de máquinas e leituras.

Próxima evolução recomendada: substituir por CTEs ou tabelas derivadas agregadas, medir com `EXPLAIN ANALYZE` e manter índices compostos por empresa/equipamento e carregamento/resultado.

### P1 — polling com renderização completa

`interface/js/aplicacao.js` atualiza a tela de Trabalho a cada dois segundos, reconstruindo o conteúdo da tela. O mecanismo evita bloquear a navegação, porém pode gerar trabalho desnecessário quando não houve alteração.

Próxima evolução recomendada: retornar `updated_at`/versão do monitoramento, atualizar somente os componentes alterados e aplicar backoff quando o navegador estiver oculto ou o serviço estiver indisponível.

### P2 — verificações de Dala em série lógica N+1

As telas de cadastro e detalhe consultam o status de cada Dala individualmente. Para poucas Dalas é simples; para instalações maiores, recomenda-se um endpoint de status em lote.

### P2 — contratos de API

As chamadas do front estão centralizadas em `ArmazenamentoTrace`, o que é positivo. A próxima melhoria de manutenção é padronizar timeout, cancelamento e tratamento de erro em um único cliente HTTP, evitando que cada método repita o mesmo fluxo.

## Organização do workspace

Foi adicionado `.editorconfig` e configuração do workspace em `.vscode/settings.json` para:

- formatar ao salvar;
- organizar imports explicitamente;
- remover espaços finais;
- manter LF e newline final;
- usar formatadores adequados para JavaScript, JSON e PHP.

O comando visual do VS Code não pôde ser executado nesta sessão porque o macOS estava bloqueado. A configuração fica pronta para ser aplicada ao abrir o workspace desbloqueado.

## Validação

- `bash testes/qualidade.sh`
- `bash testes/regressao_completa.sh`: 37 aprovadas, 0 falhas
- simulador Modbus virtual: aprovado
- API de saúde: PHP e MySQL aprovados
- `git diff --check`: aprovado

Não foram alteradas regras de negócio, dados de produção ou comandos físicos do CLP.

## Adendo — atualização de 2026-10-19

As telas **Alertas** e **Resumo final** passaram a solicitar somente os dados que exibem. O endpoint protegido `/api/monitoramento.php` oferece as visões `alertas` e `resumo`; sem `view`, mantém o snapshot completo para os consumidores existentes.

- Alertas: leituras, status de dispositivos e estado das Dalas (3 consultas).
- Resumo final: contagem de leituras, ocorrências recentes e pendências de sincronização (3 consultas).
- Seleção de Dala na operação consulta o endpoint leve de status de dispositivos; o encerramento atualiza o resumo próprio, sem buscar o snapshot completo.
- A abertura da Operação deixou de carregar 50 romaneios que não são exibidos nessa tela; a lista continua sendo carregada nas telas que a apresentam.
- O resumo final antes usava o snapshot completo, que executava 8 consultas. A nova visão reduz o número de consultas da tela em 5 por atualização, sem mudar os indicadores ou sua janela de período.
- Os estados `alertMonitoring` e `summaryMonitoring` são separados do snapshot operacional para respostas parciais não sobrescreverem dados usados em outras telas.

Validação incremental: suíte de qualidade, PHPUnit, PHPStan, testes focados das duas telas e Semgrep passaram. A redução de consultas foi comprovada pelos caminhos de código e testes; não foi medida contra o banco real nem no PC industrial. A medição de latência e planos de execução com dados representativos continua pendente.

## Adendo — recursos do PC industrial em 2026-10-19

Uma leitura somente de consulta por SSH encontrou o worker da câmera em ~50% de CPU (138 MiB/384 MiB), o MySQL em ~98% do limite de memória (503 MiB/512 MiB), o worker de sincronização em ~21% de CPU e o Node-RED em ~9%. A máquina Windows tinha cerca de 1,8 GiB de RAM livre.

O worker da câmera agora fica ocioso sem decodificar vídeo. A cada heartbeat, faz uma sonda TCP curta à porta RTSP; quando a fila recebe um pedido, abre uma sessão FFmpeg, solicita um único JPEG com `-frames:v 1` e encerra o processo. A URL continua entrando pelo stdin, sem aparecer nos argumentos do processo. Isso reduz uso contínuo de CPU, largura de banda e memória; o tempo de abertura do RTSP passa a fazer parte da latência da captura.

Essa correção ainda está apenas no checkout local; não alterei nem reiniciei o PC. A queda de CPU e a ausência de credenciais nos argumentos precisam ser verificadas depois de instalar a versão que contém o worker atualizado. A margem de memória do MySQL também precisa ser acompanhada em uso real; esta amostra não identifica sozinha se o consumo é buffer do InnoDB, conexões ou outros buffers.

## Adendo — leitura operacional e rastreabilidade em 2026-10-19

O endpoint de leituras passou a delegar normalização e validação do payload a `SolicitacaoLeitura`, mantendo na API a autenticação, a transação e a resposta HTTP. Um `sensor_event_id` preenchido mas inválido agora é rejeitado com HTTP 422 em vez de ser descartado silenciosamente; o campo continua opcional quando ausente, nulo ou vazio.

No reenvio de uma leitura offline, `RepositorioLeituras` busca o registro de auditoria e a leitura original com um `LEFT JOIN`, reduzindo de duas consultas a uma nessa rota e mantendo os filtros por empresa e carregamento. Isso comprova menos chamadas ao banco no caminho de repetição, mas não é uma medição de latência em MySQL real ou no PC industrial.

Validação desta etapa: `testes/qualidade.sh` passou; 33 testes focados de PHP passaram com 181 assertions; PHPStan não encontrou erros; Semgrep `p/default` encontrou zero achados nos arquivos alterados. O fluxo de escrita completo e a latência no banco industrial continuam fora da medição local.

## Adendo — carregamento sob demanda das telas em 2026-10-19

`interface/js/aplicacao.js` deixou de importar estaticamente os renderizadores das 21 telas. `criarRegistroTelas` importa apenas a tela solicitada, compartilha importações concorrentes e permite nova tentativa se um carregamento falhar. O teclado de leitura manual foi separado do módulo de Operação para não forçar a carga dessa tela em outras rotas. A navegação inicia, em paralelo, a carga do CSS exclusivo, do renderizador e dos dados iniciais.

O service worker mantém o pré-cache do shell para operação sem rede. Para as importações versionadas pelo release atual, ele consulta o cache da versão ativa pelo caminho do arquivo; isso permite usar o módulo pré-carregado mesmo que a URL contenha `?v=`. Falhas de rede continuam usando o fallback de cache existente. O verificador de dependências do frontend agora inclui imports dinâmicos no grafo.

Validação local desta alteração: 64 testes focados de navegação/operação/registro de telas passaram. O teste de cache inicialmente revelou expectativas antigas de versão para os imports de Operação, Importação e Configurações; depois de alinhá-las ao novo registro dinâmico, a suíte completa `bash testes/qualidade.sh` passou, incluindo o teste de versão/cache. O grafo encontrou 84 módulos alcançáveis, a verificação de sintaxe dos módulos alterados e `git diff --check` passaram. Não foi feita medição de tempo ou CPU no navegador nem no PC industrial, portanto o efeito de desempenho ainda precisa ser medido nesse hardware.

Na instalação do service worker, os recursos do shell eram buscados todos ao mesmo tempo. O pré-cache agora limita o paralelismo a quatro arquivos e registra no console o caminho de qualquer recurso que falhar; os arquivos continuam sendo pré-carregados para uso offline. Essa mudança reduz a concorrência máxima, mas não o volume total de transferência. A suíte `bash testes/qualidade.sh` passou após a alteração, incluindo o teste de versão/cache. O tempo de instalação e o pico de recursos ainda não foram medidos no PC industrial.

Os limites aceitos pelo serviço de monitoramento agora são definidos uma vez e normalizados pelo mesmo helper: período máximo de 3650 dias, sinal do CLP até 60 segundos e sinal da câmera até 300 segundos, com mínimo de 1. As rotas de snapshot, alertas e máquinas mantêm os mesmos valores e limites. Validação após essa refatoração: `bash testes/qualidade.sh` passou e `vendor/bin/phpunit --filter ServicoMonitoramentoTest` passou (6 testes, 43 assertions).

## Adendo — inicialização de serviços da interface em 2026-10-19

Romaneios, catálogo, contas e instalações industriais agora são importados e
instanciados somente quando uma tela usa esses domínios. O armazenamento
compartilha uma única importação concorrente por serviço; se ela falhar, a
entrada pendente é removida e uma chamada posterior pode tentar novamente.
`selectCompany` continua síncrono para preservar o contrato usado pela
navegação. Os serviços operacionais de Dala, carregamento, comandos e leituras
permanecem imediatos para não atrasar a operação.

Os quatro módulos continuam no pré-cache do service worker para manter o uso
offline. A mudança reduz a avaliação e a criação de objetos na inicialização,
mas não o volume total de arquivos do pré-cache. O efeito em tempo de abertura,
memória e CPU precisa ser medido no PC industrial; esta alteração não foi
publicada.

As configurações de ações e gatilhos da Dala também foram extraídas para um
serviço de domínio carregado apenas quando a tela de configuração as consulta.
O serviço concentra método HTTP, payload, tratamento de erro e recarga do
estado após gravações; a fachada mantém os mesmos métodos usados pelas telas.

Preparação, troca de Dala, desbloqueio e finalização passaram a ser coordenados
por `ServicoCarregamentoAtivo`. A fachada apenas mantém o contrato público da
interface. O serviço continua carregado no caminho operacional; a mudança
organiza a regra sem acrescentar importação tardia ao primeiro comando.

Validação desta etapa: os testes de ciclo de carregamento e resumo passaram,
`node scripts/check_frontend_modules.mjs` encontrou 85 módulos alcançáveis,
`git diff --check` passou e `bash testes/qualidade.sh` terminou com código 0.
O teste de qualidade inicialmente expôs uma expectativa antiga que construía
a fachada sem seus serviços; ele foi atualizado para usar a instância real e
continuar verificando que a finalização não busca o snapshot completo. Não
houve medição de CPU, memória ou latência no navegador do PC industrial.

## Adendo — política de fila offline em 2026-10-19

A política de quais gravações podem entrar na fila offline, a inclusão do
`X-Trace-Offline-Id` e a resposta HTTP 202 foram movidas da fachada para
`ServicoSincronizacao`. A mesma instância continua responsável por encaminhar
pendências ao buffer e comunicar a contagem atualizada ao estado da aplicação.
O gerador criptográfico existente é injetado pela fachada, sem duplicação nem
importação adicional no caminho de inicialização.

Validação local: 36 testes de sincronização, fila offline, inicialização de
serviços e cache passaram; o verificador encontrou 85 módulos alcançáveis e
`git diff --check` passou. A suíte completa `bash testes/qualidade.sh` também
terminou com código 0. O comportamento em rede instável no PC industrial
continua coberto por testes automatizados, mas não foi medido em operação real.
