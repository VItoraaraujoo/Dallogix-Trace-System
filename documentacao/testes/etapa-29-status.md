# Status dos testes — Etapa 29

## STATUS

IMPLEMENTADA — correções funcionais do interface operacional.

## CORREÇÕES

- Retry da sincronização agora usa também a URL salva em Configurações.
- Monitor Tablet atualiza carregamento e monitoramento a cada segundo.
- Tablet exibe última leitura e bloqueio de emergência.
- Configurações podem ser abertas pelos perfis da empresa em modo leitura; alteração permanece exclusiva do administrador.
- Animações e transições visuais removidas.
- Espaçamento do Dashboard e cartões de Dala ampliado para evitar sobreposição.
- Cache do interface atualizado para `app.js?v=3`.

## TESTE

`bash testes/etapa29.sh`
