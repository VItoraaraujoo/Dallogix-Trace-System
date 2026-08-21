# Node-RED local

Integração industrial ainda pendente de confirmação do protocolo e dos registradores do CLP Delta DVP14SS. Nesta etapa o container apenas fornece a infraestrutura do Node-RED.

## Sincronização remota

O backend mantém eventos em `sync_queue`. O processamento só envia dados quando `SYNC_REMOTE_URL` estiver configurada no `.env`; sem essa variável, os eventos permanecem `PENDENTE`, preservando o modo local-first.

## Captura imediata

O Node-RED deverá chamar `/api/camera_worker.php` com `X-Internal-Token` igual a `CAMERA_INTERNAL_TOKEN`:

1. `POST {"action":"CLAIM"}` para reservar a próxima captura;
2. disparar a câmera conforme o protocolo confirmado;
3. `POST {"action":"COMPLETE","request_id":N,"image_path":"..."}` para vincular a imagem ao carregamento.

O protocolo da câmera ainda precisa ser confirmado com o fabricante. O backend não considera uma captura concluída sem o callback `COMPLETE`.
