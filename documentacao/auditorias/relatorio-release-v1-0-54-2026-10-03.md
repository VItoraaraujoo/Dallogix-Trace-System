# Relatório de revisão e publicação — v1.0.54

**Data:** 03/10/2026

**Repositório:** `VItoraaraujoo/Dallogix-Trace-System`

**Commit publicado:** `de8fc35d637ef5401ceaf087f2a5fb0c3d62a686`

**Tag:** `v1.0.54`
**Execução de release:** GitHub Actions `Publicar versão de produção #61`

## Resultado da publicação

- O job `windows-installer` terminou com sucesso.
- O job `release` terminou com sucesso em 5m23s.
- O Central responde `status=ok`, com PHP e MySQL saudáveis, versão `v1.0.54` e o commit `de8fc35`.
- A release contém `TraceSetup.exe`, `trace-v1.0.54.tar.gz`, `manifest.json` e `dallogix-trace-sbom.spdx.json`.

O endpoint comprovado nesta publicação é `https://trace.santocloud.com.br`. O host `trece.dallogix.com` informado como domínio de produção não resolve no DNS durante esta revisão; por isso a URL ativa não foi trocada para um endereço sem DNS/HTTPS confirmado.

## Verificações automatizadas

Executadas no checkout da tag publicada:

| Verificação | Resultado comprovado |
| --- | --- |
| PHPUnit | 32 testes, 185 asserções, todos aprovados |
| PHPStan | sem erros |
| Qualidade JavaScript/PHP e referências | 37 módulos alcançáveis, sem erro |
| Testes industriais Node.js | 38 testes, todos aprovados |
| Transporte Modbus Python | 5 testes, todos aprovados |
| Configuração Docker Compose | válida |
| Verificação de segredos de alto risco | sem ocorrência bloqueante |
| `git diff --check` | sem erro |

## PC industrial de teste

Verificado por SSH via Tailscale após a atualização automática:

- `C:\DallogixTrace\armazenamento\updates\current_version`: `v1.0.54`.
- API local: `status=ok`, PHP e MySQL saudáveis, modo `local`, commit `de8fc35`.
- Log do atualizador: `Trace atualizado com sucesso para v1.0.54`.
- O backup automático anterior à troca foi registrado pelo próprio atualizador.
- A migration `061_indices_fila_sincronizacao` está registrada em `schema_migrations`.
- Os índices `idx_fila_agregado_ordem` e `idx_fila_status_disponivel_empresa` existem em `fila_sincronizacao`.
- Containers Node-RED, sincronização, retenção, PHP, câmera e MySQL estavam ativos; os containers com healthcheck estavam saudáveis.
- O EXE instalado informa `ProductVersion 1.0.0+de8fc35`; o registro de inicialização do Windows aponta para `C:\DallogixTrace\DallogixTrace.exe`.

A sessão `admin` estava desconectada no momento da consulta (`quser`), portanto o processo visual do EXE não foi declarado como aberto. Ele iniciará no próximo login por meio do registro já confirmado.

## Status operacionais observados no banco local

| Campo | Estado observado | Evidência |
| --- | --- | --- |
| CLP | `ONLINE` | heartbeat Node-RED recente, Modbus TCP, IP `192.168.1.10`, porta `502`, unidade `1`, função `3`, registrador `2052`, valor diagnóstico `0` |
| Câmera | `OFFLINE` | `camera_config_missing`, `stream_ready=false` |
| Sensor | sem heartbeat registrado | não há linha de sensor em `status_dispositivos` |
| Scanner | sem heartbeat registrado | não há linha de scanner em `status_dispositivos` |
| Servidor local | `ok` | `/api/health.php` respondeu com PHP e MySQL saudáveis |
| Fila de sincronização | 66 `ENVIADO`, 0 `MORTO` | consulta direta em `fila_sincronizacao` |

Esses estados não são substituídos por um valor presumido: câmera, sensor e scanner só serão marcados online quando houver heartbeat ou captura real correspondente.

## Alterações de código desta revisão

- Removidos três arquivos de configuração sem referências de runtime.
- Adicionada migration idempotente com índices para a fila de sincronização.
- Reduzida uma consulta redundante de prontidão, calculando a idade do evento na consulta já existente.
- Incluídos testes para impedir produtos inativos em novos romaneios e preservar um produto inativo já gravado durante edição para permitir substituição.
- O teste de produtos foi incluído nos gates de qualidade, deploy e release.
- A revisão completa foi registrada em `revisao-completa-2026-10-03.md`.

## Limites que continuam explícitos

- A bateria não enviou comandos físicos ao CLP; os endereços `2049`, `2050` e `2051` continuam protegidos contra escrita sem confirmação operacional.
- A câmera não foi declarada online porque não havia configuração/stream real disponível no PC.
- Não foi inventado benchmark de produção; os testes de carga física e de câmera dependem do equipamento conectado.
- Nomes técnicos de protocolos, campos de payload, migrations e tabelas históricas permanecem como contratos de compatibilidade. Renomeá-los globalmente para português exigiria uma migração coordenada entre Central, PC, Node-RED e instalador e não foi feito de forma insegura.
