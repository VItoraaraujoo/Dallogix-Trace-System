# Convenção de nomenclatura do Dallogix Trace

## Objetivo

Manter o sistema em português na camada funcional e operacional, preservando nomes de tecnologias, frameworks e integrações que dependem de convenções externas e não podem ser alterados sem quebrar a infraestrutura.

## Regra principal

1. Pastas e arquivos de domínio do negócio devem usar nomes em português.
2. Pastas e arquivos técnicos de infraestrutura devem manter os nomes padrão da ferramenta ou do ecossistema.
3. Nenhum nome interno deve ser alterado se isso comprometer build, runtime, integração ou compatibilidade.

## Exemplos aprovados

- `interface/` → mantido
- `servidor/` → mantido
- `banco-de-dados/` → mantido
- `documentacao/` → mantido
- `configuracoes`, `carregamentos`, `romaneios`, `usuarios`, `empresas`, `relatorios`, `auditoria` → nomes em português
- `docker-compose.yml`, `nginx`, `mysql`, `node-red`, `php` → mantidos por exigência técnica

## Exceções intencionais

Os nomes abaixo devem permanecer no padrão da tecnologia, mesmo quando o restante do sistema está em português:

- `docker/`
- `nginx/`
- `php/`
- `mysql`
- `node-red`
- `modbus-virtual`
- `tmp/` e `output/` somente quando forem artefatos de ambiente, não módulos de negócio

## Regras para novas alterações

- Sempre criar nomes em português para módulos de operação, regras, telas e relatórios.
- Sempre manter nomes da infraestrutura, pacotes e comandos exatamente como a ferramenta exige.
- Quando a funcionalidade for de negócio e não de runtime, priorizar termos em português, sem abreviações ambíguas.
- Evitar misturar termos em inglês e português no mesmo módulo.

## Status do projeto

O sistema já está em grande parte em português na camada funcional. Os ajustes restantes devem seguir esta convenção e priorizar compatibilidade e estabilidade operacional.

## Organização por tela e domínio

Cada tela web fica em sua própria pasta, com os três arquivos de entrada usando o mesmo nome em português:

```text
interface/telas/operacao/
├── operacao.html
├── operacao.css
└── operacao.js
```

A implementação das telas fica no JS da tela principal de cada domínio (por exemplo, `romaneios.js`, `dalas.js` e `alertas.js`); telas irmãs exportam apenas o componente correspondente a partir desse arquivo para evitar duplicação. A navegação, a sessão e a ligação dos eventos continuam centralizadas em `interface/js/aplicacao.js`; utilitários reutilizáveis ficam em `interface/js/funcoes/`.

Os endpoints PHP ficam agrupados por domínio, pois vários deles atendem mais de uma tela e integrações industriais:

```text
servidor/api/
├── autenticacao/
├── camera/
├── dalas/
├── empresas/
├── monitoramento/
├── operacoes/
├── produtos/
├── relatorios/
├── romaneios/
├── sincronizacao/
├── sistema/
└── usuarios/
```

Os arquivos PHP antigos na raiz de `servidor/api/` são encaminhadores de compatibilidade. Assim, as URLs atuais continuam funcionando sem manter duas cópias das regras de negócio.
