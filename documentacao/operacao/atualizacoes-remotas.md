# Atualizações remotas

O Trace pode receber versões remotamente, mas a máquina industrial só instala uma versão quando não existe carregamento em andamento. Não há cobrança automática nem ação remota sobre o CLP.

## Fluxo seguro

1. O servidor de distribuição publica um pacote imutável e um manifesto assinado.
2. A máquina consulta o manifesto por HTTPS e valida canal, versão, SHA-256 e assinatura com uma chave pública instalada localmente.
3. Antes de instalar, confirma que a API do Central ja serve a mesma versao e o mesmo commit incorporado ao pacote.
4. O agente verifica no banco se há carregamento `PREPARANDO`, `CARREGANDO`, `PAUSADO`, `FINALIZANDO` ou `EMERGENCIA`. Se houver, a atualização é recusada e pode ser tentada novamente depois.
5. Sem operação ativa, cria backup do banco e dos arquivos, instala a versão em uma área de releases e reinicia os serviços.
6. O healthcheck local precisa confirmar a mesma versao e commit do Central. Caso contrário, o atualizador tenta restaurar a versão anterior e mantém o PC em manutenção se a recuperação falhar.

O horário recomendado é uma janela de manutenção, por exemplo 03:30. O operador não precisa abrir terminal e não vê serviços técnicos; a equipe técnica continua podendo executar `TRACE_UPDATE_DRY_RUN=1` para validar um pacote sem instalar.

## Contrato do manifesto

```json
{
  "channel": "stable",
  "version": "v1.2.3",
  "artifact_url": "https://updates.exemplo.dallogix/trace-v1.2.3.tar.gz",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "signature": "BASE64_DA_ASSINATURA_RSA_SHA256"
}
```

A assinatura é RSA-SHA256 sobre exatamente estas três linhas, terminadas por uma quebra de linha:

```text
version
artifact_url
sha256
```

A chave privada fica somente no servidor de distribuição. A máquina recebe apenas o arquivo de chave pública configurado em `UPDATE_PUBLIC_KEY_FILE`. O pacote deve conter `docker-compose.yml` e uma estrutura compatível com a instalação atual.

## Configuração Linux

No `.env` da máquina:

```dotenv
UPDATE_MANIFEST_URL=https://github.com/VItoraaraujoo/Dallogix-Trace-System/releases/latest/download/manifest.json
UPDATE_PUBLIC_KEY_FILE=/opt/dallogix-trace/servidor/configuracao/trace-update-public.pem
UPDATE_CHANNEL=stable
```

Esses valores são os padrões do atualizador e podem ser substituídos no `.env` quando a instalação usa outro canal/servidor. Copie `deploy/systemd/dallogix-trace-sync.service` e `deploy/systemd/dallogix-trace-sync.timer` para `/etc/systemd/system/`, depois habilite o timer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dallogix-trace-sync.timer
```

O timer verifica a cada minuto; o atualizador valida assinatura, integridade e ausência de carregamento ativo antes de instalar. Para testar sem alterar nada:

```bash
TRACE_UPDATE_DRY_RUN=1 bash scripts/update_trace.sh
```

## Publicação pelo GitHub

O workflow `.github/workflows/release-production.yml` é manual. Primeiro incorpore o código aprovado à `master` e crie uma tag SemVer (`v1.2.3`, por exemplo). Em seguida, execute o workflow a partir da `master` e informe essa tag. Ele confirma que a tag existe e aponta para um commit incorporado à `master`, executa as validações, compila o instalador Windows e monta um único pacote assinado para Linux e Windows.

O workflow atualiza o Central usando `scripts/update_trace.sh`, que bloqueia novas preparações, recusa cargas ativas, faz backup, aplica as migrations e valida a aplicação local. Se o atualizador indicar que outra atualização está em execução ou que há cargas ativas, o workflow tenta novamente a cada 30 segundos por até 30 minutos; os demais erros encerram a execução imediatamente. Se o Central continuar ocupado ao final desse prazo, nenhuma release é publicada. Antes e depois da atualização, o workflow consulta `http://127.0.0.1:${WEB_PORT}/api/health.php` no próprio servidor por SSH e só publica a release do GitHub quando o Central está saudável e informa a mesma versão e o mesmo commit. Assim os PCs não recebem a release antes do Central. Essa confirmação local não verifica DNS, TLS, Cloudflare ou a rota pública. Antes de iniciar o workflow, confirme a API pública `https://trace.santocloud.com.br/api/health.php` de uma conexão externa; se a rota pública não estiver acessível, adie a publicação. A consulta automatizada ao endpoint público foi removida porque o Cloudflare responde HTTP 403 ao runner do GitHub. O workflow `deploy-test.yml` executa somente a checagem de qualidade e não altera servidores.

Configure no ambiente protegido `production-release` do GitHub os seguintes itens:

- Segredos `UPDATE_SIGNING_PRIVATE_KEY`, `CENTRAL_SERVER_SSH_KEY` e `CENTRAL_SERVER_SSH_KNOWN_HOSTS`. O último deve conter a chave de host SSH obtida e conferida pela equipe; o workflow exige correspondência e não usa `ssh-keyscan` durante o deploy.
- Variáveis `CENTRAL_SERVER_SSH_HOST`, `CENTRAL_SERVER_SSH_USER`, `CENTRAL_SERVER_SSH_PORT` e `CENTRAL_SERVER_PATH`. O workflow obtém `WEB_PORT` do `.env` no servidor e usa esse valor para validar localmente a API de saúde.
- A conta SSH precisa gravar no caminho configurado e acessar o Docker e o banco utilizados pelo Central. Configure também as proteções e os revisores exigidos pela política de mudança de produção.

A chave privada de assinatura e a chave SSH nunca devem entrar no repositório. O projeto distribui a chave pública de atualização em `servidor/configuracao/trace-update-public.pem`; a instalação industrial deve apontar `UPDATE_PUBLIC_KEY_FILE` para a cópia local desse arquivo e consultar o manifesto da última release estável:

```dotenv
UPDATE_MANIFEST_URL=https://github.com/VItoraaraujoo/Dallogix-Trace-System/releases/latest/download/manifest.json
UPDATE_PUBLIC_KEY_FILE=/opt/dallogix-trace/servidor/configuracao/trace-update-public.pem
UPDATE_CHANNEL=stable
```

Para publicar uma correção, incorpore o commit à `master`, crie e envie uma nova tag, e então execute o workflow manual com essa tag:

```bash
git checkout master
git pull --ff-only origin master
git tag -a v1.2.3 -m "Dallogix Trace v1.2.3"
git push origin master v1.2.3
```

Em macOS, o LaunchAgent consulta a `master` diretamente a cada 60 segundos. Linux usa o timer systemd e Windows usa a tarefa `Dallogix Trace Atualizacao`; ambos consultam a última release assinada a cada minuto, depois que o workflow a publica. Todos adiam a atualização durante carregamento ativo. Linux/Windows verificam assinatura, integridade, backup e healthcheck, com rollback automático se a nova versão falhar. Se já houver PCs Linux/Windows instalados sem timer/tarefa, a equipe técnica precisa ativar o mecanismo uma vez em cada PC; novas instalações já recebem essa configuração.

## Sincronização remota em lote

O endpoint individual `SYNC_REMOTE_URL` continua sendo compatível com instalações
existentes: cada requisição recebe um evento JSON. Para reduzir conexões em uma
instalação com servidor central homologado, configure também `SYNC_REMOTE_BATCH_URL`.
Nesse modo, o worker envia uma requisição `POST` com este envelope:

```json
{
  "events": [
    {
      "event_uuid": "...",
      "company_id": 7,
      "aggregate_type": "leitura",
      "aggregate_id": 42,
      "payload": {"action": "LEITURA_REGISTRADA"}
    }
  ]
}
```

O servidor central só deve responder `2xx` depois de aceitar o lote inteiro e
deve tratar `event_uuid` como chave idempotente. Qualquer resposta fora de `2xx`
faz todos os eventos do lote voltar para `ERRO` com backoff; não há confirmação
parcial implícita. O token é enviado como `Authorization: Bearer` nos dois modos.

## Windows industrial

O `TraceSetup.exe` de produção é compilado de uma tag aprovada por `Build-TraceSetup.ps1`. O instalador grava `trace-build-version.txt` e `trace-build-commit.txt`, exige que o Central sirva os mesmos identificadores, preenche apenas campos vazios de `UPDATE_MANIFEST_URL`, `UPDATE_PUBLIC_KEY_FILE` e `UPDATE_CHANNEL` no `.env` e registra a tarefa `Dallogix Trace Atualizacao Estavel` para 03:30, executada pela conta de sistema. Antes de criar a tarefa, ele confirma que essa conta consegue acessar o Docker Linux; se não conseguir, a instalação informa a falha. A tarefa usa `TraceUpdater.ps1` e escreve `armazenamento/logs/update-stable.log`. Git for Windows é instalado na preparação para executar os scripts existentes de backup e migrations.

O atualizador compara versões SemVer e não instala uma release igual ou anterior. Com uma versão nova, valida a assinatura e o SHA-256, bloqueia novas preparações, confirma ausência de carregamentos ativos, interrompe os escritores antes do backup, aplica migrations e verifica a API local com MySQL. Se a troca falhar, tenta restaurar os arquivos e o banco; uma falha de rollback mantém o marcador de manutenção e exige atendimento técnico. Uma versão que falhou não é tentada repetidamente sem revisão.

Um PC já instalado por ZIP não passa a atualizar só porque a tarefa foi adicionada ao código no GitHub. Ele precisa receber o instalador correspondente uma vez. O ZIP de homologação procura na `master` o commit efetivamente servido pelo Central; máquinas de operação real recebem somente releases aprovadas e aguardam o Central servir a mesma release antes de instalar. O launcher continuará abrindo o Trace em quiosque após a atualização.

Nenhum mecanismo de atualização pode garantir troca instantânea em PCs desligados, sem rede ou com carregamento ativo. Durante esse intervalo, o PC conserva a versão local e a fila de sincronização; a equipe técnica deve acompanhar os PCs pendentes antes de considerar a implantação concluída.

## Limites importantes

- Não atualizar durante carregamento, retorno, emergência ou intervenção.
- Não aceitar HTTP, pacote sem assinatura ou chave pública recebida junto com o pacote.
- Não atualizar firmware do CLP por este mecanismo.
- Revogar um token remoto impede novas consultas, mas não interrompe uma operação já iniciada.
