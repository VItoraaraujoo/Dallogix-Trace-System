# Retenção de imagens

- Prazo definido: **30 dias**.
- Somente imagens de incidentes são persistidas.
- O script `scripts/prune_images.php` remove registros e arquivos locais expirados.
- O script deve ser executado diariamente por cron, launchd ou agendador do servidor.

Exemplo no container PHP:

```bash
docker compose exec php php /var/www/scripts/prune_images.php
```

Para produção, o job deve usar credenciais do banco por ambiente e backup antes da limpeza.
