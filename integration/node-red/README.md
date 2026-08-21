# Node-RED local

Integração industrial ainda pendente de confirmação do protocolo e dos registradores do CLP Delta DVP14SS. Nesta etapa o container apenas fornece a infraestrutura do Node-RED.

## Sincronização remota

O backend mantém eventos em `sync_queue`. O processamento só envia dados quando `SYNC_REMOTE_URL` estiver configurada no `.env`; sem essa variável, os eventos permanecem `PENDENTE`, preservando o modo local-first.
