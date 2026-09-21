# Runbooks operacionais

Procedimentos curtos para diagnóstico seguro no chão de fábrica. Preserve o
carregamento local e não reinicie o CLP durante uma operação ativa sem a
autorização do supervisor.

## RUNBOOK-001 — Internet indisponível

- Sintoma: indicador do central sem comunicação ou fila crescendo.
- Confirmar: abrir o painel técnico e verificar `last_remote_sync_error` e a idade da fila.
- Ação segura: manter a operação local; não apagar a fila. Restabelecer a rede e aguardar o worker.
- Escalar: se a fila tiver erros após três tentativas ou permanecer acumulada após o retorno.

## RUNBOOK-002 — Câmera sem captura

- Sintoma: captura pendente ou erro no painel técnico.
- Confirmar: verificar o status CAMERA, espaço livre e os últimos comandos.
- Ação segura: preservar a solicitação e validar energia, endereço e credencial da câmera.
- Escalar: se houver falha de armazenamento ou captura repetida em mais de uma leitura.

## RUNBOOK-003 — CLP não responde

- Sintoma: CLP offline, timeout ou comando rejeitado.
- Confirmar: conferir IP/porta permitidos, status do gateway e estado físico da esteira.
- Ação segura: não liberar emergência pelo software sem confirmação física no CLP.
- Escalar: manutenção elétrica quando a comunicação não voltar após a verificação de rede.

## RUNBOOK-004 — Fila de sincronização acumulada

- Sintoma: pendentes antigos, erros ou fila morta.
- Confirmar: consultar profundidade, idade e erro da fila no painel técnico.
- Ação segura: corrigir a causa e usar retry individual; nunca editar payload diretamente.
- Escalar: analisar a fila morta e registrar a correção antes de resolver o evento.

## RUNBOOK-005 — Disco quase cheio

- Sintoma: alerta de espaço ou falha ao salvar evidência.
- Confirmar: verificar percentual livre e retenção configurada.
- Ação segura: fazer backup, validar o backup e executar a retenção aprovada.
- Escalar: se o espaço continuar abaixo do limite após a retenção.

## RUNBOOK-006 — Licença bloqueada

- Sintoma: login, heartbeat ou sincronização rejeitados.
- Confirmar: consultar o status da licença no servidor central.
- Ação segura: interromper novos carregamentos e preservar os dados locais.
- Escalar: somente o Master deve reativar a licença.

## RUNBOOK-007 — Restaurar backup

- Sintoma: banco corrompido ou perda de dados.
- Confirmar: validar o arquivo com `scripts/verify_backup.sh`.
- Ação segura: parar a operação, registrar o horário e restaurar somente o arquivo escolhido.
- Escalar: após a restauração, executar o smoke test e conferir a sincronização.

## RUNBOOK-008 — Rollback de atualização

- Sintoma: healthcheck não fica pronto após atualização.
- Confirmar: consultar o commit instalado e os logs do atualizador.
- Ação segura: deixar o rollback automático concluir; não remover o backup anterior.
- Escalar: se a versão anterior também não passar no healthcheck.

## RUNBOOK-009 — Emergência não desbloqueia

- Sintoma: solicitação de desbloqueio pendente ou rejeitada.
- Confirmar: verificar o comando no painel técnico e a confirmação do gateway.
- Ação segura: confirmar intertravamentos e segurança física no CLP; o Trace não substitui o operador.
- Escalar: manutenção e supervisor quando o CLP não confirmar a liberação.
