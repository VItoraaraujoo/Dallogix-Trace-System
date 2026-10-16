# Histórico de alterações

## v1.0.153 — 16/10/2026

- A tarefa de atualização estável agora faz até 12 novas tentativas após falhas,
  com intervalo de 5 minutos, para aguardar o Docker Desktop após o logon do Windows.
- O atualizador repara a agenda existente também quando a política de novas
  tentativas está ausente, sem depender de reinstalar o programa.
- Adicionadas regressões automatizadas para o limite e o intervalo de tentativas.

## v1.0.152 — 16/10/2026

- O atualizador identifica a conta que executa o quiosque pelo processo antes
  de interrompê-lo e agenda a reabertura na mesma sessão interativa, inclusive
  quando `Win32_ComputerSystem.UserName` não está preenchido em uma sessão RDP.
- A atualização é adiada se não for possível identificar uma única conta dona
  da interface, evitando deixar o quiosque fechado após a manutenção.
- Adicionada regressão automatizada para o reinício da interface em sessões RDP.

## v1.0.139 — 13/10/2026

- O formulário de novo romaneio mostra validações e erros da API na própria tela,
  e retorna ao login quando a sessão expirou.
- A criação não é mais considerada falha se a atualização posterior da lista
  der erro; a navegação para Romaneios faz a consulta separadamente.
- Itens incompletos não são descartados silenciosamente ao salvar.
- Adicionadas regressões automatizadas para validação, feedback e confirmação
  do cadastro.
- Publicação pendente de validação pelo workflow de produção.

## v1.0.111 — 06/10/2026

- O atualizador estável também tenta a atualização dez minutos após o logon,
  depois que o Docker Desktop tem tempo para iniciar.

## v1.0.110 — 06/10/2026

- A instalação do PC industrial agora registra a tarefa `Trace-Docker-Start`
  com o executável real do Docker Desktop e execução no logon da conta técnica.
- Corrigido o caminho legado em `Downloads`, que podia deixar o Docker sem
  inicialização após reiniciar o Windows.
- Adicionada regressão automatizada para preservar essa configuração nas novas
  instalações.
- Publicação pendente de validação pelo workflow de produção.

## v1.0.109 — 06/10/2026

- A auditoria de controle de acesso agora resolve os wrappers da API e analisa
  as dependências PHP locais carregadas por `require __DIR__`, eliminando
  avisos falsos de bootstrap ausente.
- Corrigida a mensagem de sucesso da auditoria para usar a grafia completa de
  autorização.
- Adicionada regressão automatizada para impedir que esse diagnóstico volte a
  ignorar endpoints delegados.
- Publicação pendente de validação pelo workflow de produção.

## v1.0.108 — 06/10/2026

- O atualizador do PC industrial inicia o transcript antes das validações de
  pré-requisitos, registrando falhas do Docker, OpenSSL, tar ou Git Bash no
  log de erros persistente.
- A mensagem de falha do mecanismo Linux do Docker agora inclui o detalhe
  retornado pelo próprio comando `docker info`.
- Adicionado teste automatizado para impedir regressão no diagnóstico das
  tarefas agendadas.
- Publicação pendente de validação pelo workflow de produção.

## v1.0.107 — 06/10/2026

- Cache da interface invalidado de forma coordenada no service worker, nas telas
  e nos módulos alterados, evitando que uma instalação continue usando código
  anterior após a atualização.
- Adicionado teste que exige a mesma versão de cache em todas as telas.

## v1.0.106 — 06/10/2026

- O status do servidor na operação agora depende do health check HTTP confirmado.
- A ausência de resposta não aparece mais como servidor online.
- Adicionado teste automatizado para os estados desconhecido e online.

As mudanças ainda não publicadas ficam em **Não publicado**. Cada implantação
expõe o commit efetivo em `/api/health.php` (`TRACE_COMMIT`); esse identificador
é a referência para comparar o histórico abaixo com o código servido. Ao criar
um release, mova os itens para uma seção com a versão/tag e a data reais.

## v1.0.105 — 06/10/2026

- A tela de alertas passou a mostrar a idade do evento mais antigo da fila e a
  quantidade de eventos na fila morta, com destaque quando o limite de idade é
  ultrapassado.
- O endpoint de status da sincronização agora entrega essa mesma saúde da fila
  (`oldest_at`, idade, limite, estado obsoleto e fila morta) para diagnóstico
  sem depender de logs ou de uma suposição de conectividade.
- Publicação pendente de validação pelo workflow de produção.

## v1.0.104 — 06/10/2026

- Impedida a criação de diretórios de relatório através de links simbólicos em
  diretórios pai; caminhos fora da raiz de armazenamento agora são recusados
  antes de qualquer criação.
- Adicionada regressão automatizada para confirmar que a recusa não deixa
  diretórios fora da raiz autorizada.
- Publicação pendente de validação pelo workflow de produção.

## v1.0.103 — 06/10/2026

- Corrigida a corrida entre comandos operacionais e quadros vazios ou atrasados
  do tempo real: a Dala selecionada permanece disponível até a confirmação
  terminal, sem deixar o botão de parada bloqueado até recarregar a tela.
- Publicação validada pelo workflow de produção `#108` no commit
  `bc7cd745875e6ff40f9721716c1e895647fb421e`; o Central confirmou a mesma
  versão e respondeu pronto.

## v1.0.102 — 06/10/2026

- Reorganizado o painel operacional da Dala: código de barras no resumo,
  estados dos dispositivos no módulo lateral e comandos agrupados sem altura
  vazia nos itens.
- Publicação validada pelo workflow de produção no commit
  `7c8c8a41d46310cd8c4cf9bc32d0660214b3ab73`; o Central confirmou a mesma
  versão e respondeu pronto.

## v1.0.101 — 06/10/2026

- Impedida a renderização atrasada de uma tela anterior após navegação ou
  conclusão de formulários e comandos assíncronos.
- Publicação validada pelo workflow de produção no commit
  `e6cf86dbf77427d7e940f2420b709ccc7b79358f`; o Central confirmou a mesma
  versão e respondeu pronto.

## Não publicado

- Alinhado o perfil padrão do gateway à leitura do bit M2052 por FC1, unidade 1,
  endereço 2052. A leitura FC1 foi confirmada no PC industrial; a FC3 no mesmo
  endereço lê um registrador holding separado e não valida o bit do sensor.
- `SEM_LEITURA` registra a ocorrência e pede evidência da câmera sem pausar o
  carregamento; a confirmação automatizada do sensor/leitor continua pendente.
- Mantidas as proteções CSRF e de limite de tentativas de login/ativação mesmo
  quando as antigas variáveis de teste estiverem definidas.
- Restringido o sistema de arquivos do MySQL, mantendo o processo como UID 999,
  com áreas temporárias graváveis, sem capacidades Linux e sem ganho de privilégios.
- Padronizado o checkout do workflow de deploy de teste na versão 5.
- Documentada a necessidade de root no passo único de preparação do volume
  persistente do Node-RED.
- Adicionada verificação de módulos JavaScript sem referência nas telas.
- Removidas três configurações PHP órfãs sem referências no runtime.
- Adicionados índices idempotentes para ordem por agregado e reserva eficiente
  da fila de sincronização.
- Reduzida uma consulta do endpoint de prontidão ao calcular a idade da fila
  junto com os contadores.
- Adicionado teste para impedir produtos inativos em novos romaneios e
  mantida a substituição segura de produtos inativos em romaneios antigos.

## Releases anteriores

O histórico anterior não foi reconstruído aqui para não atribuir mudanças a
versões sem evidência. Consulte as tags e o histórico Git para releases passados.
