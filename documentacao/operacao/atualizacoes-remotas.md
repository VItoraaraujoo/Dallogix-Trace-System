# Atualizações remotas

O Trace pode receber versões remotamente, mas a máquina industrial só instala uma versão quando não existe carregamento em andamento. Não há cobrança automática nem ação remota sobre o CLP.

## Fluxo seguro

1. O servidor de distribuição publica um pacote imutável e um manifesto assinado.
2. A máquina consulta o manifesto por HTTPS e valida canal, versão, SHA-256 e assinatura com uma chave pública instalada localmente.
3. O agente verifica no banco se há carregamento `PREPARANDO`, `CARREGANDO`, `PAUSADO`, `FINALIZANDO` ou `EMERGENCIA`. Se houver, a atualização é recusada e pode ser tentada novamente depois.
4. Sem operação ativa, cria backup do banco e dos arquivos, instala a versão em uma área de releases e reinicia os serviços.
5. O healthcheck precisa responder. Caso contrário, a versão anterior é restaurada automaticamente.

O horário recomendado é uma janela de manutenção, por exemplo 03:30. O operador não precisa abrir terminal e não vê serviços técnicos; a equipe técnica continua podendo executar `TRACE_UPDATE_DRY_RUN=1` para validar um pacote sem instalar.

## Contrato do manifesto

```json
{
  "channel": "stable",
  "version": "2026.08.30.1",
  "artifact_url": "https://updates.exemplo.dallogix/trace-2026.08.30.1.tar.gz",
  "sha256": "064c...256 caracteres hexadecimais...e91a",
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

O workflow `.github/workflows/release-production.yml` publica automaticamente uma release assinada a partir de cada commit da `master` depois das validações de qualidade, segurança e integração. Ele incrementa a versão patch SemVer e publica um pacote imutável, manifesto assinado e SBOM. O gatilho por tag SemVer continua disponível para uma publicação técnica explícita, desde que a tag aponte para um commit incorporado à `master`.

Configure no ambiente protegido `production-release` do GitHub o segredo `UPDATE_SIGNING_PRIVATE_KEY`. A chave privada nunca deve entrar no repositório. O projeto distribui a chave pública em `servidor/configuracao/trace-update-public.pem`; a instalação industrial deve apontar `UPDATE_PUBLIC_KEY_FILE` para a cópia local desse arquivo e consultar o manifesto da última release estável:

```dotenv
UPDATE_MANIFEST_URL=https://github.com/VItoraaraujoo/Dallogix-Trace-System/releases/latest/download/manifest.json
UPDATE_PUBLIC_KEY_FILE=/opt/dallogix-trace/servidor/configuracao/trace-update-public.pem
UPDATE_CHANNEL=stable
```

Para publicar uma correção, basta incorporar o commit à `master`; o workflow executa os gates e publica a versão. Não é necessário criar uma tag manual. O procedimento por tag continua disponível quando a equipe técnica precisa escolher uma versão explícita:

```bash
git checkout master
git pull --ff-only origin master
git tag -a v1.2.3 -m "Dallogix Trace v1.2.3"
git push origin v1.2.3
```

Em macOS, o LaunchAgent consulta a `master` diretamente a cada 60 segundos. Linux usa o timer systemd e Windows usa a tarefa `Dallogix Trace Atualizacao`; ambos consultam a release assinada criada a partir da mesma `master` a cada minuto. Todos adiam a atualização durante carregamento ativo. Linux/Windows verificam assinatura, integridade, backup e healthcheck, com rollback automático se a nova versão falhar. Para manter a publicação automática, o ambiente `production-release` deve armazenar `UPDATE_SIGNING_PRIVATE_KEY` e não exigir aprovação manual por release. Se já houver PCs Linux/Windows instalados sem timer/tarefa, a equipe técnica precisa ativar o mecanismo uma vez em cada PC; novas instalações já recebem essa configuração.

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

O `Setup-TraceMachine.ps1` configura URL e chave pública padrão; o `Install-TraceMachine.ps1` registra a tarefa `Dallogix Trace Atualizacao`, executada como `SYSTEM` a cada minuto e sem sobreposição. Se uma versão falhar, ela fica marcada para impedir tentativas automáticas repetidas até a equipe técnica investigar e remover a marca. O launcher continua abrindo o Trace em quiosque após a atualização. A conta do operador não deve ter permissão administrativa para alterar a tarefa. Para PC já instalado, a equipe técnica precisa cadastrar os valores `UPDATE_*` no `.env` e executar novamente o instalador de máquina para registrar a tarefa.

## Limites importantes

- Não atualizar durante carregamento, retorno, emergência ou intervenção.
- Não aceitar HTTP, pacote sem assinatura ou chave pública recebida junto com o pacote.
- Não atualizar firmware do CLP por este mecanismo.
- Revogar um token remoto impede novas consultas, mas não interrompe uma operação já iniciada.
