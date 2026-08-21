# Node-RED local

Integração industrial preparada para o Delta DVP14SS. A variante exata, o mapa de registradores e o protocolo final ainda precisam ser confirmados em bancada; a referência preferencial é Modbus RTU via RS-485.

O scanner Elgin EL8600 ficará conectado ao PC industrial em USB ou RS-232 e permanecerá em leitura contínua. O adaptador deverá manter um buffer das leituras e associá-las ao evento do sensor recebido do CLP. Se o evento não receber código dentro da janela operacional definida, o backend registra `SEM_LEITURA` e solicita a captura imediata da câmera.

## Sincronização remota

O backend mantém eventos em `sync_queue`. O processamento só envia dados quando `SYNC_REMOTE_URL` estiver configurada no `.env`; sem essa variável, os eventos permanecem `PENDENTE`, preservando o modo local-first.

## Captura imediata

O Node-RED deverá chamar `/api/camera_worker.php` com `X-Internal-Token` igual a `CAMERA_INTERNAL_TOKEN`:

1. `POST {"action":"CLAIM"}` para reservar a próxima captura;
2. disparar a câmera conforme o protocolo confirmado;
3. `POST {"action":"COMPLETE","request_id":N,"image_path":"..."}` para vincular a imagem ao carregamento.

O protocolo da câmera ainda precisa ser confirmado com o fabricante. O backend não considera uma captura concluída sem o callback `COMPLETE`.
