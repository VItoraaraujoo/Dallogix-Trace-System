# Revisão de segurança para produção

## Correções aplicadas

- cookies de sessão passam a usar `Secure` em produção;
- headers `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy`;
- token CSRF para mutações em todos os ambientes;
- healthcheck não retorna detalhes do erro do banco;
- limite de CSV de 5 MB e 10.000 linhas;
- portas do Docker vinculadas a `127.0.0.1` por padrão;
- token padrão da câmera recusado em produção;
- senha não fica mais preenchida na tela de login;
- Content Security Policy no Nginx, com `connect-src 'self'`;
- rate limit de login e ativação no PHP em todos os ambientes, por IP e combinação IP/identidade ou IP/código, sem bloqueio global de uma conta/código;
- modo estrito de sessão, cookies `SameSite=Strict` e revalidação do usuário ativo em cada requisição autenticada;
- sessão somente por cookie HttpOnly; a aba envia apenas uma chave aleatória de contexto, e rotas de dispositivo/token de instalação não criam sessão PHP;
- autenticação de dispositivo por hash SHA-256 de token aleatório de 256 bits, sem bcrypt em cada chamada;
- fila de sincronização limitada a `ADMIN_EMPRESA` e `SUPERVISOR`; `dispositivos.php` somente consulta status e o heartbeat é exclusivo do token do equipamento;
- debounce de sensor baseado no horário do banco, configurável por `TRACE_DEBOUNCE_MS`, com horário do dispositivo guardado separadamente quando próximo do horário do servidor;
- códigos de ativação com 130 bits aleatórios, uso único e validade de 7 dias; as migrations 054–056 rotacionam códigos curtos, guardam horário do dispositivo e indexam a retenção de limites;
- retenção de `limites_login`, comparação de senha falsa para login inexistente e atualização fail-closed do estado local da licença;
- destinos HTTPS remotos fixados aos IPs DNS validados antes da conexão; caminhos internos de imagem removidos das respostas de listagem;
- logs não ocultam mais erros de schema conhecidos, e os rótulos/atributos dinâmicos usados nos sinks HTML são escapados ou filtrados;
- limites de requisição e conexões no Nginx, limite de corpo de 6 MB e rate limit específico para login;
- headers de segurança também aplicados aos arquivos estáticos;
- validação de produção carrega o `.env` antes de verificar `APP_ENV`, segredos e HTTPS.

## Obrigatório antes da publicação externa

- trocar todos os segredos e credenciais locais;
- usar HTTPS no proxy de produção;
- ao publicar atrás de proxy, configurar o IP/CIDR confiável no `real_ip` do Nginx; sem isso, clientes podem compartilhar o mesmo bucket de rate limit;
- configurar armazenamento compartilhado do rate limit se o serviço vier a operar com múltiplas réplicas;
- restringir acesso ao Node-RED e ao banco por rede/firewall;
- adicionar backup, logs centralizados e alertas;
- manter CORS desativado enquanto a interface e a API forem same-origin;
- revisar permissões por empresa e por equipamento;
- executar teste de invasão e análise de dependências.
- colocar o serviço web público atrás de WAF/proxy com proteção DDoS; os limites do Nginx são apenas uma camada local;
- preservar o limite de uma instalação local por empresa até que suporte a múltiplos PCs seja projetado e validado.

CSRF e rate limit não podem mais ser desligados por variáveis de teste, nem no
PC industrial em `APP_ENV=local`. A configuração de produção agora exige um
`TRACE_INSTALLATION_MODE` explícito e segredos próprios. A migration 054
invalida códigos de ativação curtos quando aplicada; gere um novo código no
gerenciamento para cada ativação inicial necessária. Os códigos novos expiram
em 7 dias e são consumidos ao registrar a credencial da instalação.
