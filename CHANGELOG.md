# Histórico de alterações

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

- Alinhado o perfil padrão do gateway industrial à leitura Modbus comprovada em
  bancada no INVT TS621: unidade 1, função 3 e endereço 2052. O IP e a porta
  continuam sendo obtidos do cadastro da Dala, e o gateway só publica `ONLINE`
  após validar o quadro recebido.
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
