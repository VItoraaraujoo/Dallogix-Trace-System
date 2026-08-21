# Revisão de segurança para produção

## Correções aplicadas

- cookies de sessão passam a usar `Secure` em produção;
- headers `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy`;
- token CSRF para mutações quando `APP_ENV=production`;
- healthcheck não retorna detalhes do erro do banco;
- limite de CSV de 5 MB e 10.000 linhas;
- portas do Docker vinculadas a `127.0.0.1` por padrão;
- token padrão da câmera recusado em produção;
- senha não fica mais preenchida na tela de login;
- Content Security Policy no Nginx.

## Obrigatório antes da publicação externa

- trocar todos os segredos e credenciais locais;
- usar HTTPS no proxy de produção;
- habilitar rate limit e bloqueio progressivo no login;
- validar caminhos de imagens contra diretório permitido;
- restringir acesso ao Node-RED e ao banco por rede/firewall;
- adicionar backup, logs centralizados e alertas;
- configurar CORS somente para domínios autorizados;
- revisar permissões por empresa e por equipamento;
- executar teste de invasão e análise de dependências.

O modo local mantém os testes existentes sem exigir CSRF, mas o ambiente de produção deve sempre usar `APP_ENV=production` e segredos fornecidos pelo ambiente de execução.
