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
php scripts/provision_api_key.php --create --company-id=ID --name=ERP-CLIENTE --scopes=empresa:read,romaneios:read --expires-at=AAAA-MM-DDThh:mm:ssZ
php scripts/provision_api_key.php --list --company-id=ID
php scripts/provision_api_key.php --revoke --id=ID_DA_INTEGRACAO
```

Na criação, `--scopes` e `--expires-at` são obrigatórios. Informe somente os
escopos que a integração usa e uma data futura RFC 3339 com fuso horário; a
ferramenta não concede todos os escopos nem cria chaves sem vencimento por
padrão.

Para executar pelo Compose, use o serviço PHP do Central e o caminho `/var/www/scripts/provision_api_key.php`. Entregue a chave ao cliente por um canal seguro; não a registre em chamados, e-mails sem proteção ou código-fonte.

## Recursos disponíveis

Todos os recursos são somente leitura na primeira versão. A chave pode receber um ou mais escopos:

| Recurso | Escopo |
| --- | --- |
| `GET /empresa` | `empresa:read` |
| `GET /romaneios` e `GET /romaneios/{id}` | `romaneios:read` |
| `GET /carregamentos` e `GET /carregamentos/{id}` | `carregamentos:read` |
| `GET /carregamentos/{id}/leituras` | `leituras:read` |
| `GET /equipamentos` (inclui estado da comunicação do CLP) | `equipamentos:read` |
| `GET /ocorrencias` | `ocorrencias:read` |
| `GET /romaneios/{id}/relatorio.pdf` | `relatorios:read` |

A raiz `/api/v1/` informa a versão e `/api/v1/openapi.yaml` entrega a especificação OpenAPI.

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

O tráfego é limitado pelo Nginx e todas as consultas são vinculadas à empresa da chave. A v1 não disponibiliza criação/alteração de romaneios nem comandos para CLP.
