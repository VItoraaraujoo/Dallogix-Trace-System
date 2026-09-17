# Homologação abrangente — Trace

Data: 17/09/2026  
Versão validada: `v1.0.10` (`32f3a24`)  
Ambientes: Trace local (`http://127.0.0.1:8080`) e servidor (`https://trace.santocloud.com.br`).

## Resultado executivo

Os fluxos principais de empresa, ativação, login, licença, Dala, produto,
romaneio, relatório, auditoria, arquivamento e exclusão definitiva foram
validados. O servidor respondeu com PHP/MySQL saudáveis e o frontend remoto
foi atualizado após a invalidação do cache dos assets.

## Matriz de testes

| Fluxo | Esperado | Resultado |
| --- | --- | --- |
| Health do servidor | PHP e MySQL disponíveis e commit atual | PASS — `/api/health.php` respondeu `ok`, `32f3a24` |
| Criar empresa | Nome, domínio derivado do nome e código único | PASS — empresa QA criada com domínio `dallogix.qa-homologacao-2026-09-17c` |
| Login Master | Master continua usando `master@dallogix.local` | PASS |
| Criar login da empresa | Login usa o domínio da empresa e senha definida já vale | PASS — `Admin QA` entrou sem troca obrigatória |
| Ativação local | Código válido ativa uma vez e a tela volta ao login normal | PASS — ativação local concluída e painel de ativação deixou de ser exibido |
| Isolamento por empresa | Usuário da empresa enxerga apenas seus dados | PASS — dashboard remoto exibiu somente a Dala QA |
| Arquivar empresa | Empresa sai da lista ativa, sem apagar dados | PASS — API local confirmou `archived=true` |
| Restaurar empresa | Empresa volta a ficar ativa | PASS — API local confirmou `archived=false` |
| Excluir sem arquivar | Operação deve ser recusada | PASS — HTTP 409 |
| Excluir definitivamente | Exclusão só ocorre após arquivamento | PASS — empresa QA temporária foi removida após arquivar |
| Excluir com dependências | Deve recusar sem `force` e permitir purga explícita | PASS — fluxo E2E local anterior validou 409 sem purga e 200 com purga |
| Bloquear licença | Novas operações devem retornar licença bloqueada | PASS — HTTP 402 local; reativação também validada |
| Produto | Cadastro aparece para a empresa | PASS — Produto QA cadastrado |
| Dala/esteira | Cadastro aceita IP/porta do CLP e exibe estado | PASS — Dala QA cadastrada |
| CLP remoto | Sem dispositivo real deve indicar ausência de comunicação | PASS — `CLP sem sinal` foi exibido para `127.0.0.1` no servidor |
| Romaneio | Criar e listar itens/quantidades | PASS — `ROM-QA-001`, 10 unidades, status Aguardando |
| Data do romaneio | Data de calendário não pode voltar um dia no fuso de Brasília | PASS — correção aplicada; relatório remoto passou a mostrar `17/09/2026` |
| Histórico/relatório | Totais, linha do romaneio e auditoria | PASS — 1 romaneio, 10 planejados e eventos de cadastro visíveis |
| Logs de erro | Exibir falhas inesperadas sem guardar segredos | PASS — local e remoto sem erros inesperados |
| Modbus TCP virtual | Ler e escrever holding register e coil | PASS — `scripts/test_modbus_virtual.py` |
| API smoke | Autenticação e entrada das APIs | PASS — `scripts/api_smoke_test.sh` |
| Qualidade/security scan | Sintaxe, referências órfãs e segredos acidentais | PASS |
| Banco de dados | Estatísticas atualizadas e consultas principais indexadas | PASS — `ANALYZE TABLE` OK; EXPLAIN usou `idx_empresas_archived_name` e `idx_usuarios_company_name` |
| Mobile | Conteúdo caber em 390×844 e controles permanecerem utilizáveis | PASS visual — dashboard e histórico sem overflow horizontal; menu recolhido e formulários empilhados |

## Navegação e botões verificados

Foram abertas e atualizadas as telas de Dashboard, Romaneios, Histórico,
Produtos, Dalas, Configurações e Logs de erros, além das telas Master de
Empresas e Usuários. Filtros, expansão do menu, criação de registros,
visualização de estado, ativação e auditoria foram exercitados.

Botões destrutivos (bloquear, arquivar e excluir definitivamente) foram
validados por API e pelo fluxo de confirmação correspondente; não foram
acionados indiscriminadamente em empresas de produção.

## Revisão técnica

- Corrigido o `GET` de carregamentos que usava uma conexão inexistente.
- Leituras do CLP agora registram o evento operacional corretamente.
- Adicionados arquivamento/restauração e exclusão definitiva separada.
- Empresas arquivadas não conseguem login nem novas operações.
- Adicionados índices para lista de empresas arquivadas e usuários por empresa.
- Corrigida a interpretação de datas `YYYY-MM-DD` para não aplicar deslocamento UTC.
- Cache do frontend e service worker versionados em `v1.0.10`.
- Busca por marcadores de erro/fatalidade e variáveis indefinidas não encontrou
  ocorrência nova; o único `console.error` restante é o tratamento genérico de
  erro no frontend.

## Limitações e pendências reais

- Não há CLP físico nesta máquina; a comunicação foi validada com Modbus TCP
  virtual. O teste em Windows 11/CLP real ainda depende do equipamento e da
  rede industrial.
- PHPUnit e PHPStan não foram executados porque `vendor/bin/phpunit` e
  `vendor/bin/phpstan` não estão instalados neste checkout.
- A regressão completa legada ficou parcial: alguns testes antigos dependem de
  fixture mutável e executam escrita sem o token CSRF; os testes individuais
  relevantes foram executados com CSRF correto e passaram.
- O botão Exportar CSV está presente e o relatório foi gerado; a captura do
  evento de download não foi obtida pelo automatizador de navegador, portanto
  esse download precisa de uma confirmação manual no navegador do usuário.
- A empresa remota `QA Homologacao 2026-09-17C` foi mantida com seus registros
  para inspeção manual do fluxo. A empresa temporária local usada no teste de
  arquivamento foi excluída definitivamente.

## Credenciais de fixture

O seed local legado mantém `admin@dallogix.local` para preservar a suíte
existente. Empresas criadas pelo Master usam o domínio próprio, por exemplo
`admin@dallogix.empresa-chat`; o login Master continua exclusivamente em
`.local`.
