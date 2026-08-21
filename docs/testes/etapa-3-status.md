# Status dos testes — Etapa 3

## Implementação

- Login local com `password_verify`.
- Sessão PHP com cookie `HttpOnly` e `SameSite=Lax`.
- Endpoint de sessão atual em `/api/me.php`.
- Logout com destruição da sessão em `/api/logout.php`.
- Tela de login integrada ao frontend.
- Usuário local: `admin@dallogix.local` / `password`.

## Validação

- Endpoint de usuário sem sessão retorna HTTP 401.
- Login válido retorna HTTP 200 e cria sessão.
- Login com senha inválida retorna HTTP 401.
- Sessão válida retorna o usuário autenticado.
- Logout retorna HTTP 200 e invalida a sessão.
- Teste reproduzível: `bash tests/etapa3.sh`.

## Resultado

Etapa 3 concluída. O próximo passo é iniciar a camada de operações com romaneios, produtos e carregamentos persistidos.
