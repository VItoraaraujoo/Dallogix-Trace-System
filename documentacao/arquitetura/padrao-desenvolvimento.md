# Padrão de desenvolvimento

## Decisão arquitetural

O Dallogix Trace opera como **monólito modular em camadas** no PC industrial. Essa escolha mantém a operação local e a recuperação offline simples, sem introduzir dependências de rede entre serviços durante o carregamento.

O sistema fica preparado para extrair, quando houver necessidade real de escala, três serviços independentes: gateway industrial (CLP), sincronização com nuvem e retenção/armazenamento de imagens. Nenhum deles é necessário para a operação local básica.

## Camadas

| Camada       | Responsabilidade                                                    | Local atual                                                                   |
| ------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Apresentação | Telas, componentes visuais e coleta de ações do usuário             | `interface/telas/<nome-da-tela>/` e `interface/css/`                                            |
| Controle     | Navegação, eventos de tela, autenticação e composição das respostas | `interface/js/aplicacao.js`, `interface/js/controladores/` e `servidor/api/`      |
| Aplicação    | Regras de carregamento, permissões, auditoria, filas e validações   | `servidor/src/Aplicacao/` e `servidor/configuracao/`                              |
| Dados        | Migrations, repositórios SQL e persistência local                   | `banco-de-dados/`, `servidor/src/Persistencia/` e MySQL                         |
| Integração   | CLP, scanner, câmera e sincronização remota por filas autenticadas  | `integracoes/`, `plc_gateway.php`, `camera_worker.php` e `sync_queue.php`     |

Na interface, `ArmazenamentoTrace` mantém a fachada do estado compartilhado. Os
serviços em `interface/js/servicos/` coordenam o acesso à API por domínio;
controladores e telas usam a fachada sem concentrar consultas HTTP nem regras
de persistência.

`interface/js/aplicacao.js` compõe navegação e controladores; atualização visual
ao vivo fica em `interface/js/controladores/estado-visualizacao.js`, enquanto
saúde local, relógio offline e shell ficam em
`interface/js/controladores/conectividade-local.js`. No PHP,
`servidor/configuracao/bootstrap.php` permanece como entrada compatível dos
endpoints e carrega os módulos de ambiente, sessão, HTTP, dispositivos,
autenticação e eventos definidos no mesmo diretório.

Ações de exportação e relatórios ficam em
`interface/js/controladores/acoes-relatorios.js`; criação de CSV, proteção
contra fórmulas e ciclo de vida dos downloads ficam em
`interface/js/funcoes/downloads.js`.

A ordem de resolução dos cliques `data-action` fica em
`interface/js/controladores/despachante-acoes.js`. `aplicacao.js` compõe os
handlers por domínio e entrega as dependências ao despachante, mantendo os
formulários e as rotas de navegação fora da lógica de cada tela.

A paginação das listas internas fica em `interface/js/funcoes/paginacao-api.js`.
Ela mantém o limite de 100 páginas com 100 registros, encaminha cancelamento e
rejeita cursores repetidos para limitar memória e impedir buscas incompletas.

## Regras para novas alterações

1. A tela apenas solicita uma ação; nunca decide a permissão definitiva.
2. O endpoint valida sessão, empresa, perfil, dados e transição de estado antes de gravar.
3. Acesso ao banco usa consultas preparadas e migrações versionadas; SQL fica em repositórios, enquanto serviços de aplicação chamam operações nomeadas.
4. Comandos ao CLP e à câmera entram em fila; a interface nunca escreve diretamente no equipamento.
5. Toda alteração operacional relevante gera auditoria e evento de sincronização.
6. Antes de integrar uma função, execute `bash testes/qualidade.sh` e o teste de etapa correspondente.
7. Ações de interface por assunto devem ficar em `interface/js/controladores/`; `aplicacao.js` fica responsável por compor a tela, navegar e ligar os controladores.
8. Novos testes devem ter nomes descritivos por funcionalidade. As etapas históricas e seu uso estão documentados em `testes/README.md`.

## Primeiro recorte em camadas

O comando de reversão, a transição de carregamento e o gateway industrial já usam o recorte completo: as rotas HTTP são controladores; `ServicoComandoClp`, `ServicoEstadoCarregamento` e `ServicoGatewayClp` guardam as regras de negócio; as tabelas existentes são a persistência atual.

## Limpeza controlada

Um arquivo só pode ser removido quando não tiver importação, referência HTML, uso em teste ou responsabilidade operacional documentada. Arquivos de migration, integrações industriais e evidências não são removidos por busca textual isolada.

## Desempenho no PC industrial

- Atualizações periódicas devem pedir somente os dados que a tela apresenta. Não use um snapshot com contagens e históricos completos para atualizar um único status ou uma lista recente.
- Consultas de leitura com sessão PHP devem chamar `session_write_close()` depois de validar usuário e empresa e antes de abrir consultas demoradas; isso impede que o polling da mesma sessão fique enfileirado.
- Resumos da fila de sincronização devem obter contagens por estado e a idade do evento pendente mais antigo na mesma consulta agrupada, evitando uma segunda varredura a cada polling.
- Consultas frequentes precisam filtrar a empresa no banco, limitar a quantidade de linhas e ter índice compatível com os filtros e a ordenação. Confirme o plano com `EXPLAIN` quando houver banco de homologação disponível.
- Ao filtrar códigos de barras, use o escopo da empresa junto com o valor: o índice é composto por empresa e código, e a igualdade entre empresa do produto e empresa do código evita leituras de outras empresas.
- Em operações com vários itens, valide e grave em lote em vez de executar uma consulta por linha. Limite o tamanho dos lotes e preserve a regra de cada fluxo: cadastro manual e API mantêm linhas repetidas; importação CSV consolida por romaneio, caminhão e produto. Na sincronização de produtos, a última atualização recebida prevalece para o mesmo código, mas um código de barras já atribuído nunca muda de produto.
- O navegador deve evitar consultas simultâneas, reduzir a frequência em abas ocultas e descartar respostas de uma tela que já não está ativa.
- Registre o volume de consultas e o tempo de resposta em homologação. Teste localmente não substitui medição no PC industrial e no banco reais.
