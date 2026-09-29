# Plano de execução consolidado

Este registro centraliza a execução das pendências reunidas nas conversas do projeto. O trabalho desta rodada fica na branch `codex/trace-plan-runner`; os três checkouts anteriores foram preservados sem edição. A branch pode ser publicada para revisão; ainda não foi integrada à `master` nem publicada em produção.

## Concluído nesta cópia

1. **Atualização e release:** release manual por tag, pacote versionado e assinado, atualização do Central pelo atualizador protegido e publicação só após confirmar versão e commit servidos. O atualizador escolhe o Compose pela instalação e mantém o bloqueio de carga ativa. Falhas ao gravar metadados ou versão instalada agora acionam rollback.
2. **Windows:** fluxo de instalação e atualização incorpora o pacote/runtime, perfil industrial e consulta de versão do Central. O instalador não habilita escrita física no CLP sem mapa oficial aprovado.
3. **Câmera:** worker e endpoints de integração estão incluídos no perfil industrial.
4. **Comandos de teste:** existe confirmação simulada local, desativada por padrão e condicionada a dois flags. Ela não envia escrita Modbus; a emergência continua no caminho físico.
5. **Backup:** a homologação compara hashes de cada linha por tabela após restaurar em banco descartável.

## Evidência local

- `bash testes/qualidade.sh`: passou.
- `node --test testes/gateway-clp.mjs testes/operacoes-offline.mjs testes/camera-upload-http.mjs testes/estado-fisico.mjs`: 26 testes passaram.
- `python3 testes/modbus-transporte.py`: 5 testes passaram com Modbus virtual.
- `python3 testes/production_backup.py`: restaurou o backup e comparou o conteúdo das 32 tabelas em banco isolado.
- `python3 testes/production_smoke.py`: passou login, TLS local, CSRF, cookies, permissões e leitura/gravação no ambiente descartável.
- O atualizador validou assinatura, hash, limpeza do bloqueio e seleção de Compose em dry-run com Bash 3.2, nos modos Central e industrial/local.
- `bash scripts/security_scan.sh` e os testes PHP isolados de conectividade e idempotência do sensor: passaram.
- Sintaxe de `integracoes/camera-worker/camera-worker.mjs` e `scripts/build_windows_zip.py`: passou.
- Sintaxe de shell e Python, `git diff --check`, os dois workflows YAML e as configurações Compose local/industrial e Central: passaram.
- Os testes Docker usaram o projeto `trace-plan-20260929`, estado em `/tmp/trace-plan-20260929` e portas locais 18443/18080. Os stacks já ativos não foram usados.

## Aguardando ambiente ou decisão externa

- **Windows:** executar o instalador e o atualizador numa máquina Windows de homologação; este Mac não tem PowerShell nem Inno Setup.
- **PHPUnit/PHPStan:** Composer e `vendor/` não estão instalados neste checkout; esses dois jobs ficam para o CI antes de uma release.
- **CLP real:** receber variante exata, mapa oficial de registradores, sinais, intertravamentos e comportamento seguro em perda de comunicação. Até lá, comandos físicos continuam bloqueados.
- **Câmera real:** receber modelo, endereço, protocolo e credencial técnica; depois validar captura e latência no ponto de instalação.
- **Portal administrativo:** a aplicação já tem área `ADMIN_DALLOGIX` para empresas, usuários e diagnóstico/logs. A expansão para gestão dos servidores, integrações e atualização remota ainda requer definir hospedagem/domínio, autenticação, ações permitidas e separação de dados.
- **Release de produção:** o ambiente GitHub `production-release` precisa dos segredos `UPDATE_SIGNING_PRIVATE_KEY`, `CENTRAL_SERVER_SSH_KEY` e `CENTRAL_SERVER_SSH_KNOWN_HOSTS`, além das variáveis `CENTRAL_SERVER_SSH_HOST`, `CENTRAL_SERVER_SSH_USER`, `CENTRAL_SERVER_PATH` e, se necessário, `CENTRAL_SERVER_SSH_PORT`. `CENTRAL_HEALTH_URL` não é usada: o workflow lê `WEB_PORT` do `.env` do Central por SSH e valida a API de saúde local antes e depois da atualização, incluindo versão e commit esperados. Antes de iniciar manualmente uma release SemVer, confirme de uma conexão externa que o HTTPS público `/api/health.php` está acessível; se não estiver, adie a publicação.
- **Agendamento de backup no servidor:** o comportamento foi validado apenas no ambiente descartável; ativar o timer real depende do acesso e da janela operacional do servidor.

## Limites de coordenação

Esta branch é a única cópia desta rodada que recebe alterações. Antes de outra conversa editar os arquivos tocados, deve conferir esta branch e integrar ou aguardar a conclusão dela. As conversas que tratam de telas, CSV, relatórios, licenças e outras tarefas já concluídas não precisam refazer essas frentes.
