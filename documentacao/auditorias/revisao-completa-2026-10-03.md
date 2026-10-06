# Revisão completa do Trace — 03/10/2026

## Escopo revisado

Foram revisados o backend PHP, a interface JavaScript/HTML/CSS, o contrato
Modbus/Node-RED, sincronização local e central, migrations MySQL, Compose,
Dockerfiles, aplicativo Windows, instalador, atualizador, testes e workflows do
GitHub Actions.

## Atualização de validação — 06/10/2026

- A release `v1.0.98` foi publicada na execução 103 do GitHub Actions a partir
  do commit `1589bf1`.
- O Central respondeu `status=ok`, `version=v1.0.98` e o mesmo commit em
  `/api/health.php`; `/api/prontidao.php` respondeu `status=ready` com PHP e
  MySQL saudáveis.
- O layout da operação recebeu uma regra final escopada para impedir que a
  coluna de itens seja esticada até a altura total da janela. A rolagem fica
  limitada à lista quando os itens excedem o espaço disponível.
- A confirmação de carregamento em tempo real agora consulta o endpoint HTTP
  antes de limpar uma operação após um quadro SSE vazio transitório.
- O PC industrial de teste estava offline no Tailscale; portanto a versão
  instalada e o reinício do equipamento permanecem sem evidência física.
- O scanner de segredos passou no código atual e também foi exercitado com uma
  falha controlada do `git grep`: “nenhuma ocorrência” retorna sucesso, enquanto
  erro do scanner retorna código 2 e mensagem explícita.
- O commit posterior `f68985c` contém essa correção de qualidade e seu teste;
  a release instalada no Central permanece v1.0.98, pois o ajuste não altera o
  pacote do PC industrial.

## Evidências da base antes da alteração

- `master` estava limpa e alinhada com `origin/master` em `365012d`.
- O repositório tinha 568 arquivos rastreados.
- Não foram encontrados `vendor`, `node_modules`, logs de produção ou arquivos
  de armazenamento rastreados.
- A varredura de segredos terminou com sucesso.
- A validação de módulos do front, sintaxe PHP/JavaScript/Shell/JSON e testes
  isolados terminou com sucesso.
- PHPUnit local: 32 testes e 185 asserções aprovados.
- PHPStan local: nenhum erro.
- Testes Node industriais e catálogo de romaneio: 38 aprovados.
- Testes Python Modbus: 5 aprovados.
- `docker compose config --quiet`: aprovado.

## Correções aplicadas

### Código órfão

Removidos os arquivos `servidor/configuracao/acesso.php`,
`servidor/configuracao/ambiente.php` e `servidor/configuracao/http.php`.
Nenhum endpoint, script, teste ou container os referenciava. O bootstrap atual
é a única entrada de configuração usada pelas rotas.

### Desempenho da sincronização

Criada a migration `061_indices_fila_sincronizacao.sql` com duas chaves
idempotentes:

- ordem por empresa, agregado e status, usada para impedir reordenação de
eventos do mesmo agregado;
- status, disponibilidade, empresa e id, usada para localizar rapidamente
  eventos prontos e empresas com fila pendente.

O endpoint de prontidão também passou a calcular a idade da fila na mesma
consulta que obtém os contadores, eliminando uma consulta adicional ao banco e
evitando transformar um valor de data em SQL por concatenação.

As migrations anteriores não foram reescritas. A migration nova só é aplicada
uma vez pelo controle `schema_migrations`.

### Catálogo de produtos

Foi acrescentado o teste `testes/produtos-romaneio.mjs`. Ele confirma que um
romaneio novo não oferece produto inativo e que a edição de um romaneio antigo
mantém o produto inativo já gravado apenas para permitir sua substituição. A
API também valida `active = 1` no servidor, portanto a regra não depende só do
front-end.

## Nomenclatura

A interface do usuário permanece em português. Nomes técnicos como `PHP`,
`JavaScript`, `Docker`, `Node-RED`, `Modbus`, `RTSP`, `WebView2`, nomes de
ações do GitHub, nomes de bibliotecas e campos do contrato HTTP não podem ser
traduzidos sem quebrar o protocolo ou a atualização remota.

O banco ainda possui nomes históricos em inglês em tabelas e colunas. Uma
renomeação global não foi feita nesta revisão porque exigiria uma migração de
compatibilidade coordenada entre o Central, cada PC industrial, payloads de
sincronização, relatórios e instalador. A tradução segura precisa ser uma fase
própria, com período de leitura dupla e rollback, e não uma troca direta em
produção.

## Itens que permanecem bloqueados por evidência

- O caminho de escrita física FC5 está implementado para M2049, M2050 e M2051,
  mas não foi declarado aceito: faltam homologação do mapa de I/O, dos
  intertravamentos e dos sinais de retorno no CLP real.
- A câmera não foi declarada online sem quadro RTSP real.
- Não há afirmação de desempenho de produção sem medição no servidor e no PC
  industrial durante carga representativa.

## Próxima verificação de release

Depois do commit desta revisão, executar os testes locais, o workflow de
qualidade e a publicação de uma nova tag somente se a `master` continuar limpa.
O PC industrial só deve receber essa tag após o Central informar a mesma versão
e o mesmo commit.
