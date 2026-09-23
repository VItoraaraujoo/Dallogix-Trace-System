# Revisão de código e integração — 23/09/2026

## Escopo e limites

Base inicial: `b69a986`. Revisão da aplicação local-first, sincronização,
gateway Node-RED, transporte Modbus, interface, instalação e testes.
Uma instalação industrial corresponde a uma Dala; o servidor central pode
gerenciar várias instalações. Nenhum teste desta revisão autoriza escrita em
hardware real nem usa o banco da empresa de homologação como fixture.

Esta revisão não substitui a homologação do Ladder, mapa Modbus, scanner,
câmera, intertravamentos e parada de emergência na máquina física.

## Plano de execução

- [x] Inventariar arquitetura, integrações e testes existentes.
- [x] Executar linha de base: PHPUnit (16 testes, 87 asserções), PHPStan nível 4.
- [x] Reproduzir e corrigir transporte Modbus e encadeamento do gateway.
- [x] Revisar filas, idempotência e sincronização local/remoto.
- [x] Revisar estados operacionais, heartbeat, scanner/câmera e permissões;
  registrar lacunas físicas sem afirmar homologação.
- [x] Revisar interface, configuração, instalação e legado sem uso.
- [x] Executar regressões isoladas e registrar resultados e limitações.

## Achados corrigidos

1. O fluxo de consulta de comandos liga a montagem do GET diretamente ao
   processamento da resposta, sem um nó HTTP entre ambos.
2. A validação de resposta Modbus não compara transação, unidade e comprimento;
   unidade 1 e holding register 0 estão fixos no fluxo.
3. O emulador e seu cliente de teste assumem que `recv` entrega todos os bytes
   solicitados; fragmentação TCP pode interromper uma requisição válida.
4. `upsertCommand` sobrescreve estados locais com o snapshot remoto, podendo
   reabrir comandos concluídos enquanto a confirmação ainda está na fila.
5. O manual principal apresenta o seed de demonstração como parte da instalação.
6. O servidor central aceitava o horário informado pelo PC industrial como
   `last_seen_at` do CLP; um relógio adiantado podia manter a Dala online.
   Agora a hora do recebimento é do banco central e os painéis exigem sinal
   recente para exibir/contar CLP online.
7. Um snapshot remoto podia apagar código de barras de outro produto com
   edição local ainda pendente. A reconciliação preserva o dono local até o
   evento sair da fila.
8. O navegador podia reenviar operação sem identidade estável, descartava
   erros HTTP e misturava operações de usuários diferentes. A fila agora é
   vinculada ao usuário/empresa e conserva o mesmo identificador no retry.
9. Snapshot remoto podia reabrir comando local concluído e sobrescrever
   configuração/itens locais ainda pendentes. A reconciliação preserva essas
   alterações até a entrega da fila.
10. Uma confirmação tardia de desbloqueio podia ignorar uma emergência mais
    recente. O ACK atrasado é rejeitado e a emergência cancela desbloqueios
    ainda pendentes.
11. O fluxo Node-RED ainda aceitava uma lista de tokens/CLPs no mesmo PC;
    agora usa somente o token da Dala deste PC. A interface não sugere mais
    porta externa nem conexão pública com a fábrica.
12. A verificação de conectividade do servidor central podia tentar TCP em
    gateway público. Ela agora consulta somente o heartbeat sincronizado;
    o teste TCP imediato após cadastro permanece restrito ao PC industrial.
13. Uma colisão de `event_uuid` em evento de sensor podia devolver o ID de
    evento pertencente a outro contexto. Retentativas só são reconhecidas
    para a mesma empresa, Dala e carregamento; colisões diferentes recebem 409.
14. A retenção de imagens resolvia caminhos relativos fora da pasta
    `armazenamento`, podendo apagar o registro e deixar o arquivo. O caminho
    é resolvido e validado dentro da pasta de evidências; erro ou ausência do
    arquivo preserva o registro para investigação.
15. A instalação local podia receber mais de uma Dala por cadastro ou
    snapshot. Uma proteção provisória serializa o cadastro e a importação e
    rejeita segunda Dala ou identidade divergente, sem apagar a existente.
16. `camera_worker.php` aceitava `COMPLETE` com um caminho textual sem arquivo.
    Há agora upload multipart autenticado e vinculado ao pedido reservado;
    `COMPLETE` exige imagem JPEG/PNG existente, decodificável, com hash
    correspondente e na pasta da empresa/Dala. Reenvio idêntico é idempotente.
17. O PHP da imagem Docker aceitava no máximo 2 MB por upload, embora a API
    documentasse 5 MB. A imagem agora admite 6 MB por arquivo (8 MB no POST),
    mantendo o limite de negócio de 5 MB. Variáveis de destinos públicos de
    dispositivos sem consumidor foram retiradas dos overlays de produção.
18. O deploy de teste não reconstruía o PHP, então a nova configuração de
    upload não chegaria ao servidor remoto. Após backup e migrations, o fluxo
    agora reconstrói e reinicia somente esse serviço, preservando o banco.

## Legado e limites

- Removido o segundo CLP virtual e o fluxo de duas Dalas. Mantidos seeds e
  migrações históricas que são usados por testes isolados e instalações antigas.
- Removida a identidade fictícia `EST-001` da resposta da API principal e da
  configuração padrão; exemplos/documentos de testes permanecem identificados
  como exemplos.
- Removidas da configuração ativa a lista de destinos TCP públicos e a opção
  de múltiplos tokens de CLP. As colunas antigas de IP público/porta externa
  permanecem no banco para não apagar dados existentes, mas não dirigem a
  conexão atual nem são solicitadas pela interface nova.
- Variáveis exemplificativas de scanner serial e câmera foram removidas do
  `.env.example`, pois não havia nenhum consumidor implementado.
- Não foi feito teste ponta a ponta contra o banco real da empresa `teste`:
  as regressões históricas escrevem fixtures e alteram licenças.
- O fluxo Node-RED foi inspecionado e testado em funções isoladas; ainda falta
  ensaio do runtime completo, com cadastro real de uma Dala e sem atuadores.
- **Bloqueio de produção:** não existe adaptador USB/serial que leia o scanner
  e associe sua leitura a um evento de sensor; `leituras.php` exige sessão de
  usuário e CSRF, portanto não é um endpoint de dispositivo industrial.
- **Bloqueio de produção:** a API da câmera agora recebe upload autenticado
  para a solicitação reservada e `COMPLETE` exige arquivo JPEG/PNG real na
  pasta da empresa/Dala. Ainda não existe worker que acione a câmera física;
  é necessário definir o modelo, o protocolo de captura e validar a imagem
  obtida do dispositivo em bancada.
- Uploads de câmera que não cheguem a `COMPLETE` podem deixar um arquivo sem
  registro em `imagens`; a retenção atual só conhece caminhos registrados no
  banco. Antes da operação contínua, é preciso uma rotina segura de
  reconciliação/limpeza dos órfãos, sem remover evidências ainda em trânsito.
- **Bloqueio de produção:** o mapa Modbus, programa Ladder, intertravamentos
  e parada física não foram homologados; o gateway rejeita escritas enquanto
  esse mapa não existir. Não há confirmação de movimento físico.
- **Bloqueio de arquitetura multi-Dala:** `instalacoes_locais` vincula somente
  a empresa, não uma Dala. O snapshot central entrega todas as Dalas da
  empresa, e o serviço local as importa. Remover o segundo simulador/token
  não garante sozinho um PC por Dala quando a empresa tiver várias. É
  necessário persistir um vínculo explícito instalação ↔ Dala, filtrar o
  snapshot e os comandos por esse vínculo. A proteção provisória de uma Dala
  impede importação ambígua, mas não permite operar uma empresa com várias
  Dalas até que o vínculo seja modelado.
  Como a instalação real ainda não tem Dala cadastrada, nenhuma identidade foi
  escolhida automaticamente ou escrita no banco nesta revisão.
- O nó TCP nativo do Node-RED 3.1.9 acumula bytes por uma janela de tempo,
  não por comprimento MBAP; fragmentação tardia ou respostas sobrepostas
  podem causar falso `OFFLINE`. Isso falha de modo conservador, mas exige
  ensaio do runtime completo e, para produção, um adaptador Modbus que leia
  exatamente o quadro e correlacione requisições.

## Registro de execução

- Nenhum `.codegraph/` no repositório; revisão por código e referências.
- Dependências de desenvolvimento instaladas a partir de `composer.lock`, sem
  alterar versões, executar plugins ou scripts de instalação.
- PHPUnit inicial: 16 testes/87 asserções aprovados. PHPStan: sem erros.
- Após integrar `c12501b` da `master` remota: PHPUnit 25 testes/130 asserções, PHPStan
  nível 4 sem erros, Node 15 testes aprovados, Python/Modbus 4 testes aprovados,
  `testes/qualidade.sh` e `git diff --check` aprovados.
- Rotas centrais de conectividade verificadas sem banco real em três cenários
  (online, antigo, ausente); idempotência do sensor validada em dois cenários
  (mesmo contexto e contexto estrangeiro).
- O contrato de upload da câmera foi exercitado via HTTP real em servidor PHP
  temporário: token incorreto, pedido não reservado, conteúdo inválido,
  `COMPLETE` sem arquivo recusado, envio válido, reenvio idempotente e
  `COMPLETE` após upload aprovado. Nenhuma imagem foi gravada no banco real.
- A imagem PHP foi reconstruída e aplicada somente ao serviço PHP local, sem
  recriar o banco. O contêiner em execução confirmou
  `upload_max_filesize=6M` e `post_max_size=8M`; a rota de saúde retornou 200.
- Leitura somente do banco local de homologação: uma empresa, um produto,
  **nenhuma Dala e nenhum dispositivo provisionado**. Logo, não há como
  demonstrar comunicação ponta a ponta neste cadastro sem intervenção do
  operador; nenhum registro foi criado pela revisão.
- A análise estática configurada no projeto (nível 4) passou. Uma execução
  exploratória em nível 6 identificou 52 problemas de tipagem, principalmente
  contratos de arrays sem tipos de valores. Não foram suprimidos nem tratados
  como prova de falha funcional; exigem refinamento progressivo dos contratos.
- Teste do CLP virtual em loopback: leitura e escrita controlada aprovadas;
  leitura é o padrão do script, escrita exige `--write-simulator` e loopback.
- A regressão histórica cria usuários/operações e altera licenças; não será
  executada contra a instalação real do usuário.
- Referência de protocolo: [guia oficial Modbus TCP](https://www.modbus.org/docs/Modbus_Messaging_Implementation_Guide_V1_0b.pdf).
  O comportamento do nó TCP foi conferido diretamente na imagem Docker
  `nodered/node-red:3.1.9` fixada no Compose.
