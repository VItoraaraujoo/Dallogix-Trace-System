# API pública do Dallogix Trace — v1

## Endereço e autenticação

A API pública deve ser consumida pelo servidor Central usando HTTPS:

```text
https://SEU_DOMINIO_CENTRAL/api/v1
```

Use uma chave individual por empresa e integração no cabeçalho Bearer:

```http
Authorization: Bearer trc_live_SUA_CHAVE
```

O segredo é mostrado uma única vez pelo provisionamento. O banco guarda somente o hash. A chave identifica a empresa, e o cliente não escolhe `company_id` na URL ou no corpo. Empresas arquivadas ou sem licença ativa recebem erro de acesso.

As chaves são provisionadas no servidor Central, fora da tela operacional do PC industrial:

```text
php scripts/provision_api_key.php --create --company-id=ID --name=ERP-CLIENTE --scopes=empresa:read,romaneios:read,romaneios:write --expires-at=AAAA-MM-DDThh:mm:ssZ
php scripts/provision_api_key.php --list --company-id=ID
php scripts/provision_api_key.php --revoke --id=ID_DA_INTEGRACAO
```

Na criação, `--scopes` e `--expires-at` são obrigatórios. Informe somente os
escopos que a integração usa e uma data futura RFC 3339 com fuso horário; a
ferramenta não concede todos os escopos nem cria chaves sem vencimento por
padrão.

Para executar pelo Compose, use o serviço PHP do Central e o caminho `/var/www/scripts/provision_api_key.php`. Entregue a chave ao cliente por um canal seguro; não a registre em chamados, e-mails sem proteção ou código-fonte.

## Recursos disponíveis

As consultas usam escopos de leitura. A primeira gravação pública cria romaneios e requer um escopo próprio. A chave pode receber um ou mais escopos:

| Recurso | Escopo |
| --- | --- |
| `GET /empresa` | `empresa:read` |
| `GET /romaneios` e `GET /romaneios/{id}` | `romaneios:read` |
| `POST /romaneios` (cria romaneio, caminhão e itens) | `romaneios:write` |

| `GET /carregamentos` e `GET /carregamentos/{id}` | `carregamentos:read` |
| `GET /carregamentos/{id}/leituras` | `leituras:read` |
| `GET /equipamentos` (inclui estado da comunicação do CLP) | `equipamentos:read` |
| `GET /ocorrencias` | `ocorrencias:read` |
| `GET /romaneios/{id}/relatorio.pdf` | `relatorios:read` |

Para criar romaneios, envie uma `Idempotency-Key` única (16 a 128 caracteres
alfanuméricos, `._:-`) e reutilize a mesma chave caso a resposta se perca.
O reenvio com o mesmo corpo retorna o romaneio original com HTTP 200 e
`Idempotent-Replayed: true`; uma chave reutilizada com outro corpo retorna 409.
Sem esse cabeçalho, o comportamento anterior de conflito por número permanece.

A raiz `/api/v1/` informa a versão e `/api/v1/openapi.yaml` entrega a especificação OpenAPI.

Para criar um romaneio, envie `equipment_code`, `number`, `scheduled_date` (`AAAA-MM-DD`), `plate` e de 1 a 100 `items`. `equipment_code` deve identificar uma Dala vinculada a um PC industrial com sincronização configurada. Cada item informa `product_id` ou `product_code` e `quantity`. `expedidor` e `driver_name` são opcionais. A empresa é sempre derivada da chave; `company_id` e campos desconhecidos são recusados. O romaneio é atribuído ao PC daquela Dala e aparece na fila operacional após a sincronização. Um número repetido para a mesma Dala retorna `409 duplicate_romaneio`, sem duplicar dados. Use a mesma `Idempotency-Key` após perda da resposta, ou `GET /romaneios?number=...` quando a requisição original não tinha a chave. O endpoint grava os dados de negócio e um registro de auditoria em uma transação. Não cria comandos, não altera configuração nem escreve no CLP.

Exemplo de consulta:

```http
GET /api/v1/carregamentos?state=FINALIZADO&limit=50
Authorization: Bearer trc_live_SUA_CHAVE
```

Listas usam paginação por cursor. `limit` aceita de 1 a 100; quando `has_more` for `true`, envie o `next_cursor` recebido na próxima chamada. Datas operacionais usam `AAAA-MM-DD`; timestamps incluem o fuso conforme o dado armazenado.

## Relatórios PDF

`GET /api/v1/romaneios/{id}/relatorio.pdf` retorna `application/pdf`. O romaneio precisa estar finalizado ou cancelado, e capturas pendentes precisam terminar. O PDF é gerado pelo serviço de relatórios do servidor que recebeu a chamada.

O Trace opera localmente e sincroniza dados com o Central. A API Central só consegue montar o relatório com os registros e arquivos disponíveis no armazenamento Central. Capturas que existam apenas no PC industrial não são buscadas remotamente por essa rota; o envio dos arquivos de evidência do PC para o Central precisa estar configurado e validado para que as fotos apareçam no PDF central.

O campo `communication_status` dos equipamentos informa comunicação recente do CLP. `ONLINE` não confirma movimento físico da esteira.

## Respostas e erros

Uma lista segue este formato:

```json
{
  "data": [],
  "pagination": {
    "limit": 50,
    "next_cursor": null,
    "has_more": false
  }
}
```

Erros incluem um código estável e um identificador de requisição:

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "A chave não tem permissão para este recurso.",
    "request_id": "..."
  }
}
```

Status usados: `401` chave ausente/inválida, `403` escopo insuficiente, `404` registro fora do escopo ou inexistente, `402` licença inativa, `405` método não permitido, `409` relatório ainda indisponível, `422` filtro/paginação inválidos, `429` limite de chamadas, `500` erro inesperado e `503` armazenamento/relatório indisponível.

O tráfego é limitado pelo Nginx e todos os acessos são vinculados à empresa da chave. A v1 permite criar romaneios, mas não permite alterá-los ou excluí-los. Nenhum endpoint da API pública envia comandos ou altera o CLP.
