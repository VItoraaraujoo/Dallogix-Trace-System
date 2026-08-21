# Dallogix Trace

Sistema local-first para controle e rastreabilidade de carregamento de sacarias em esteiras industriais.

## Tecnologias

HTML, CSS, JavaScript, PHP, MySQL, Node-RED, Nginx, Docker e Docker Compose.

## Etapa atual

Etapa 17 — evidência de incidentes. O ambiente base, a operação persistida, o login, a tela de trabalho, auditoria, fila local, monitoramento, ocorrências, catálogo, importação transacional, equipamento único, sincronização segura, status dos dispositivos e captura seletiva de evidências estão disponíveis. A integração com CLP real ainda não foi iniciada.

## Executar

1. Copie `.env.example` para `.env` e ajuste os valores.
2. Execute `docker compose up -d --build`.
3. Acesse `http://localhost:8080`.
4. Verifique a API local em `http://localhost:8080/api/index.php`.
5. Verifique a saúde em `http://localhost:8080/api/health.php`.

## Banco local

Com os containers ativos, aplique as migrations e o seed:

```bash
docker compose exec -T mysql mysql -u root -pchange-me-root trace_local < database/migrations/001_initial_schema.sql
docker compose exec -T mysql mysql -u root -pchange-me-root trace_local < database/migrations/002_operational_schema.sql
docker compose exec -T mysql mysql -u root -pchange-me-root trace_local < database/seeds/001_local_seed.sql
```

O seed cria uma empresa, usuário administrador, máquina, esteira, produto e barcode para desenvolvimento local.

Credencial local: `admin@dallogix.local` / `password`.

## Parar e reiniciar

```bash
docker compose down
docker compose up -d
```

## Pendências técnicas

- Protocolo e mapa de registradores do CLP.
- Interface do scanner ELGIN EL8600.
- Endereço e protocolo da câmera IP.
- Credenciais e endpoint da nuvem Dallogix.

As decisões externas estão organizadas em [docs/pendencias/decisoes-pendentes.md](docs/pendencias/decisoes-pendentes.md). O desenvolvimento local-first não depende dessas informações para continuar.
