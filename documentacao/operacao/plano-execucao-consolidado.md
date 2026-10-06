# Plano de execução consolidado

Este registro centraliza a execução das pendências reunidas nas conversas do projeto. O estado abaixo corresponde à `master` no commit `f68985c` e à release `v1.0.98`, publicada no Central após a validação do pacote, das migrações e da saúde dos serviços.

## Concluído na master e publicado

1. **Atualização e release:** a release `v1.0.98` foi gerada a partir do commit `1589bf1`, validada na execução 103 do GitHub Actions e aplicada pelo atualizador protegido do Central. O healthcheck confirmou `status=ok`, `version=v1.0.98`, `installation_mode=central` e o mesmo commit; a prontidão confirmou PHP e MySQL saudáveis. O atualizador escolhe o Compose pela instalação, mantém o bloqueio de carga ativa e aciona rollback quando não consegue gravar metadados ou a versão instalada.
2. **Windows:** fluxo de instalação e atualização incorpora o pacote/runtime, perfil industrial e consulta de versão do Central. O instalador não habilita escrita física no CLP sem mapa oficial aprovado.
3. **Câmera:** worker e endpoints de integração estão incluídos no perfil industrial.
4. **Comandos e emergência:** o gateway possui caminho de escrita Modbus FC5 para M2049 (esteira), M2050 (reversão) e M2051 (emergência), com eco e mapa válidos exigidos pelo bloqueio seguro. A homologação física desses sinais, intertravamentos e retorno do CLP ainda não foi executada.
5. **Backup:** a homologação compara hashes de cada linha por tabela após restaurar em banco descartável.
6. **Tempo real operacional:** eventos SSE agora confirmam o carregamento pelo endpoint HTTP antes de limpar uma operação quando um quadro transitório chega vazio. Isso evita que o botão de parada desapareça ou fique bloqueado até recarregar a tela.
7. **Acessibilidade operacional:** progresso e estado do dispositivo expõem `role`, valores ARIA e regiões vivas para leitores de tela sem alterar o contrato de operação.
8. **Qualidade do repositório:** o commit `f68985c` diferencia ausência de ocorrências de falha do scanner de segredos e cobre os dois caminhos com teste automatizado. Essa correção é de qualidade do repositório; não altera o pacote v1.0.98 nem exige atualização do PC.

## Evidência local

- `bash testes/qualidade.sh`: passou.
- `vendor/bin/phpunit --testdox`: passou localmente com 32 testes e 185 asserções.
- `vendor/bin/phpstan analyse --no-progress`: passou sem erros.
- `node --test testes/gateway-clp.mjs testes/operacoes-offline.mjs testes/camera-upload-http.mjs testes/estado-fisico.mjs`: 26 testes passaram.
- `python3 testes/modbus-transporte.py`: 5 testes passaram com Modbus virtual.
- `python3 testes/production_backup.py`: restaurou o backup e comparou o conteúdo das 32 tabelas em banco isolado.
- `python3 testes/production_smoke.py`: passou login, TLS local, CSRF, cookies, permissões e leitura/gravação no ambiente descartável.
- O atualizador validou assinatura, hash, limpeza do bloqueio e seleção de Compose em dry-run com Bash 3.2, nos modos Central e industrial/local.
- `bash scripts/security_scan.sh` e o teste de falha controlada do `git grep`: passaram; falha do scanner agora interrompe a execução com código distinto de “nenhuma ocorrência”.
- O workflow oficial de produção concluiu os jobs `windows-installer` e `release` na execução 103, incluindo o backup pré-atualização, as migrações controladas, a recriação dos containers e a publicação da release `v1.0.98`.
- Sintaxe de `integracoes/camera-worker/camera-worker.mjs` e `scripts/build_windows_zip.py`: passou.
- Sintaxe de shell e Python, `git diff --check`, os dois workflows YAML e as configurações Compose local/industrial e Central: passaram.
- Os testes Docker usaram o projeto `trace-plan-20260929`, estado em `/tmp/trace-plan-20260929` e portas locais 18443/18080. Os stacks já ativos não foram usados.

## Aguardando ambiente ou decisão externa

- **PC industrial Windows:** a versão `v1.0.98` está disponível no Central, mas o PC de teste está offline no Tailscale desde `2026-10-06T06:19:40Z`; a tentativa SSH expirou. A instalação e o reinício ainda não podem ser declarados até a máquina voltar à rede.
- **CLP real:** receber variante exata, mapa oficial de registradores, sinais, intertravamentos e comportamento seguro em perda de comunicação. O caminho de escrita está implementado, mas a aceitação física continua pendente.
- **Câmera real:** receber modelo, endereço, protocolo e credencial técnica; depois validar captura e latência no ponto de instalação.
- **Portal administrativo:** a aplicação já tem área `ADMIN_DALLOGIX` para empresas, usuários e diagnóstico/logs. A expansão para gestão dos servidores, integrações e atualização remota ainda requer definir hospedagem/domínio, autenticação, ações permitidas e separação de dados.
- **Release de produção:** o ambiente `production-release` foi usado com sucesso na execução 103. O workflow lê `WEB_PORT` do `.env` do Central por SSH e valida a API de saúde local antes e depois da atualização, incluindo versão e commit esperados.
- **Agendamento de backup no servidor:** o backup pré-atualização foi comprovado no log da execução 103. A validação periódica de restauração continua sendo a evidência complementar prevista no workflow de backup.

## Limites de coordenação

O commit publicado nesta rodada é a única referência da correção de tempo real. Antes de outra conversa editar os arquivos tocados, deve conferir a `master` e preservar as alterações locais não relacionadas (`.gitignore` e `documentacao/arquitetura/uml/`). As conversas que tratam de telas, CSV, relatórios, licenças e outras tarefas já concluídas não precisam refazer essas frentes.
