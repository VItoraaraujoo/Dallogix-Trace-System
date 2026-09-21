# Checklist de homologação por versão

Use este checklist antes de promover uma tag de produção. Registre o commit,
ambiente, operador, data e evidências de cada item.

- [ ] Instalação limpa
- [ ] Migração a partir da versão anterior
- [ ] Login de operador, supervisor e Master
- [ ] Ativação de instalação local
- [ ] Importação de romaneio por CSV/PDF
- [ ] Preparação e carregamento normal
- [ ] Leitura válida até 100%
- [ ] Geração, recebimento e conclusão de comando pelo gateway
- [ ] Emergência e desbloqueio confirmado
- [ ] Desbloqueio rejeitado permanece seguro
- [ ] Queda e retorno da internet sem perda da fila
- [ ] Backup, validação e restauração
- [ ] Atualização remota com backup e rollback
- [ ] Painel técnico: banco, fila, heartbeat, disco e commit
- [ ] Fila morta: arquivamento após tentativas e resolução auditada
- [ ] Smoke test final e conferência do SHA instalado
