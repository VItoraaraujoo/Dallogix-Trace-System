# Diagramas UML do Dallogix Trace

Este diretório reúne os 14 tipos de diagrama UML 2.5 aplicados ao Trace. Cada arquivo .puml é um modelo separado que pode ser aberto em um renderizador PlantUML.

## Estrutura

1. Diagrama de classes — entidades e relações centrais do domínio.
2. Diagrama de objetos — fotografia ilustrativa de uma operação em andamento.
3. Diagrama de pacotes — organização das áreas do código.
4. Diagrama de estrutura composta — colaboração interna dos elementos do PC industrial.
5. Diagrama de componentes — responsabilidades e dependências dos módulos.
6. Diagrama de implantação — nós físicos, containers e conexões.
7. Diagrama de perfil — estereótipos e regras do domínio industrial.
8. Diagrama de casos de uso — atores e funcionalidades.
9. Diagrama de atividades — processamento de uma leitura industrial.
10. Diagrama de máquina de estados — transições de um carregamento.
11. Diagrama de sequência — captura e inclusão de evidência no relatório.
12. Diagrama de comunicação — mensagens do mesmo fluxo vistas pelas ligações entre participantes.
13. Diagrama de tempo — parâmetros temporais configurados para a câmera, sem tratá-los como SLA medido.
14. Diagrama de visão geral de interação — visão de alto nível dos fluxos e seus desvios.

## Limites do modelo

- Os diagramas descrevem arquitetura e contratos; não substituem o esquema completo do banco, a configuração de cada instalação nem a homologação do CLP e da câmera.
- O modelo é local-first: interface, API PHP, MySQL, Node-RED, sincronização, câmera e arquivos locais ficam no PC industrial. O PC inicia a sincronização HTTPS de saída; o Central não abre conexão TCP direta com o CLP.
- Comandos físicos são encaminhados pelo gateway industrial autenticado e dependem da confirmação do CLP. Emergência e intertravamentos permanecem no CLP.
- O fluxo de API pública v1 aparece como integração em preparação no checkout local. Os arquivos correspondentes ainda não fazem parte do commit b01d13e; não representam uma API publicada em produção.
- O diagrama de tempo usa padrões de configuração do código. Os valores não são medições de latência nem compromisso de desempenho.
- Os diagramas de perfil, estrutura composta e visão geral de interação usam recursos gráficos PlantUML para expressar esses conceitos UML; o texto dentro de cada modelo informa quando a notação é uma representação.

## Arquivos

- 01-diagrama-de-classes.puml
- 02-diagrama-de-objetos.puml
- 03-diagrama-de-pacotes.puml
- 04-diagrama-de-estrutura-composta.puml
- 05-diagrama-de-componentes.puml
- 06-diagrama-de-implantacao.puml
- 07-diagrama-de-perfil.puml
- 08-diagrama-de-casos-de-uso.puml
- 09-diagrama-de-atividades.puml
- 10-diagrama-de-maquina-de-estados.puml
- 11-diagrama-de-sequencia.puml
- 12-diagrama-de-comunicacao.puml
- 13-diagrama-de-tempo.puml
- 14-diagrama-de-visao-geral-de-interacao.puml
