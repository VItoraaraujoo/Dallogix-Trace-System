import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";
import { ServicoInstalacoesIndustriais } from "../interface/js/servicos/ServicoInstalacoesIndustriais.js";

const read = (path) => readFileSync(path, "utf8");

function criarStoreInstalacoes(pages) {
  const store = Object.create(ArmazenamentoTrace.prototype);
  store.state = {
    selectedCompanyId: 4,
    industrialInstallations: [],
    industrialEquipmentOptions: [],
  };
  store.api = {
    fetch: async () => new Response(JSON.stringify(pages.shift()), { status: 200 }),
  };
  store.servicoInstalacoesIndustriais = new ServicoInstalacoesIndustriais({
    api: store.api,
    state: store.state,
    jsonHeaders: () => ({}),
    jsonResponse: (...args) => ArmazenamentoTrace.prototype.jsonResponse.call(store, ...args),
    validarCursorPaginacao: (...args) =>
      ArmazenamentoTrace.prototype.validarCursorPaginacao.call(store, ...args),
  });
  return store;
}

test("o cliente percorre todas as páginas sem perder filtros da URL", async () => {
  const store = Object.create(ArmazenamentoTrace.prototype);
  const requests = [];
  const pages = [
    { data: [{ id: 4 }], pagination: { has_more: true, next_cursor: "4" } },
    { data: [{ id: 9 }], pagination: { has_more: false, next_cursor: null } },
  ];
  store.api = {
    fetch: async (path) => {
      requests.push(path);
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    },
  };

  const rows = await store.fetchAllPages("/api/empresas.php?include_archived=1");

  assert.deepEqual(rows, [{ id: 4 }, { id: 9 }]);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0], "http://trace.local").searchParams.get("include_archived"), "1");
  assert.equal(new URL(requests[0], "http://trace.local").searchParams.get("cursor"), "0");
  assert.equal(new URL(requests[1], "http://trace.local").searchParams.get("cursor"), "4");
});

test("o cliente recusa cursor de página repetido ou inválido", async () => {
  const store = Object.create(ArmazenamentoTrace.prototype);
  store.api = {
    fetch: async () => new Response(JSON.stringify({
      data: [{ id: 4 }],
      pagination: { has_more: true, next_cursor: "0" },
    }), { status: 200 }),
  };

  await assert.rejects(store.fetchAllPages("/api/produtos.php"), /cursor de paginação inválido/);
});

test("a paginação não duplica uma lista que terminou antes da outra", async () => {
  const store = criarStoreInstalacoes([
    {
      data: {
        installations: [{ id: 1, name: "PC 1" }],
        equipment_options: [{ id: 10, name: "Dala 1" }],
      },
      pagination: { has_more: false, next_cursor: null },
      equipment_pagination: { has_more: true, next_cursor: 10 },
    },
    {
      data: {
        installations: [{ id: 1, name: "PC 1" }],
        equipment_options: [{ id: 11, name: "Dala 2" }],
      },
      pagination: { has_more: false, next_cursor: null },
      equipment_pagination: { has_more: false, next_cursor: null },
    },
  ]);

  await store.loadIndustrialInstallations();

  assert.deepEqual(store.state.industrialInstallations, [{ id: 1, name: "PC 1" }]);
  assert.deepEqual(store.state.industrialEquipmentOptions, [
    { id: 10, name: "Dala 1" },
    { id: 11, name: "Dala 2" },
  ]);
});

test("a paginação de instalações falha com metadados ausentes em vez de truncar", async () => {
  const store = criarStoreInstalacoes([{
    data: { installations: [{ id: 1 }], equipment_options: [{ id: 10 }] },
    pagination: { has_more: false, next_cursor: null },
  }]);

  await assert.rejects(store.loadIndustrialInstallations(), /metadados de paginação inválidos/);
});

test("a trava de migrations permanece na mesma sessão MySQL e libera erro de conexão", () => {
  const migrationRunner = read("scripts/migrate.sh");
  assert.match(migrationRunner, /SELECT GET_LOCK\('\$\{migration_lock\}', 30\), CONNECTION_ID\(\); SELECT SLEEP\(86400\)/);
  assert.match(migrationRunner, /SELECT IS_USED_LOCK\('\$\{migration_lock\}'\)/);
  assert.match(migrationRunner, /KILL CONNECTION \$\{lock_connection_id\}/);
  assert.match(migrationRunner, /IS_USED_LOCK\('\$\{migration_lock\}'\) <> \$\{lock_connection_id\}/);
  assert.match(migrationRunner, /sleep 1\s+lock_wait_seconds=/);
  assert.match(migrationRunner, /information_schema\.processlist WHERE id = \$\{lock_connection_id\}/);
  assert.match(migrationRunner, /wait "\$lock_pid"/);
  assert.doesNotMatch(migrationRunner, /coproc MIGRATION_MYSQL/);
  assert.doesNotMatch(migrationRunner, /mysql_query "SELECT GET_LOCK/);
});

test("listas internas usam cursor e o cliente percorre páginas sem truncar silenciosamente", () => {
  for (const path of [
    "servidor/api/usuarios/usuarios.php",
    "servidor/api/produtos/produtos.php",
    "servidor/api/dalas/equipamentos.php",
    "servidor/api/empresas/empresas.php",
    "servidor/api/instalacoes_industriais.php",
  ]) {
    const source = read(path);
    assert.match(source, /parametros_paginacao_lista\(/, path);
    assert.match(source, /id > :cursor/, path);
    assert.match(source, /LIMIT :fetch_limit/, path);
  }
  const client = read("interface/js/classes/ArmazenamentoTrace.js");
  const installationsService = read("interface/js/servicos/ServicoInstalacoesIndustriais.js");
  const accountsService = read("interface/js/servicos/ServicoAdministracaoContas.js");
  const manifestsService = read("interface/js/servicos/ServicoRomaneios.js");
  assert.match(client, /async fetchAllPages\(/);
  assert.match(client, /loadIndustrialInstallations\(\)\s*\{\s*return this\.delegarParaServico\(this\.obterServicoInstalacoesIndustriais, "loadIndustrialInstallations"\)/);
  assert.match(client, /loadCompanies\(\)\s*\{\s*return this\.delegarParaServico\(this\.obterServicoAdministracaoContas, "loadCompanies"\)/);
  assert.match(client, /loadUsers\(\)\s*\{\s*return this\.delegarParaServico\(this\.obterServicoAdministracaoContas, "loadUsers"\)/);
  assert.match(installationsService, /result\.pagination/);
  assert.match(installationsService, /nextInstallationCursor/);
  assert.match(installationsService, /LIMITE_REGISTROS = TAMANHO_PAGINA \* LIMITE_PAGINAS/);
  assert.match(installationsService, /ultrapassa \$\{LIMITE_REGISTROS\.toLocaleString\("pt-BR"\)\} registros/);
  assert.match(installationsService, /industrialEquipmentOptions = equipmentOptions/);
  assert.match(accountsService, /async createUser\(payload\)/);
  assert.match(accountsService, /async updateLicense\(payload\)/);
  assert.match(accountsService, /async deleteCompany\(/);
  assert.match(accountsService, /async loadCompanyDetail\(\)/);
  assert.match(accountsService, /company_id=\$\{this\.state\.selectedCompanyId\}/);
  assert.match(client, /loadManifests\(\)\s*\{\s*return this\.delegarParaServico\(this\.obterServicoRomaneios, "loadManifests"\)/);
  assert.match(client, /updateManifest\(payload\)\s*\{\s*return this\.delegarParaServico\(this\.obterServicoRomaneios, "updateManifest", payload\)/);
  assert.match(manifestsService, /params\.set\("per_page", "50"\)/);
  assert.match(manifestsService, /JSON\.stringify\(\{ action: "update", \.\.\.payload \}\)/);
  assert.match(manifestsService, /"X-CSRF-Token": csrfToken/);
});

test("a migration recusa vínculos entre empresas e roda sem criar triggers", () => {
  const migration = read("banco-de-dados/migrations/067_integridade_referencial_por_empresa.sql");
  for (const expected of [
    "Migration 067 bloqueada",
    "fk_item_romaneio_company",
    "fk_item_product_company",
    "fk_item_truck_romaneio",
    "fk_loading_romaneio_company",
    "fk_loading_equipment_company",
    "fk_loading_truck_romaneio",
    "fk_romaneio_assigned_installation_company",
    "chk_romaneio_assigned_installation_pair",
    "fk_api_idempotency_key_company",
    "fk_api_idempotency_romaneio_company",
  ]) assert.ok(migration.includes(expected), `restrição ausente: ${expected}`);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
});

test("a exclusão do PC limpa a atribuição composta antes de remover a instalação", () => {
  const source = read("servidor/api/instalacoes_industriais.php");
  const deletion = source.slice(source.indexOf('if ($action === "delete_archived")'));
  const clearAssignments = deletion.indexOf("UPDATE romaneios");
  const deleteInstallation = deletion.indexOf("DELETE FROM instalacoes_industriais");
  assert.ok(clearAssignments >= 0, "O fluxo de exclusão precisa limpar os romaneios atribuídos.");
  assert.ok(deleteInstallation > clearAssignments, "A FK RESTRICT exige limpar os dois campos antes da exclusão.");
  assert.match(deletion.slice(clearAssignments, deleteInstallation), /assigned_installation_id = NULL, assigned_installation_company_id = NULL/);
  assert.match(deletion, /\$pdo->beginTransaction\(\)/);
});

test("todos os caminhos de inclusão de itens gravam a empresa no próprio registro", () => {
  const itemRepository = read("servidor/src/Persistencia/RepositorioItensRomaneio.php");
  const insert = itemRepository.match(/INSERT INTO romaneio_itens\s*\(([^)]*)\)\s*VALUES/);
  assert.ok(insert, "o repositório compartilhado deve inserir linhas de romaneio");
  assert.match(insert[1], /\bcompany_id\b/);
  assert.match(itemRepository, /array_chunk\(\$normalizedItems, self::MAX_LINHAS_POR_LOTE\)/);

  for (const path of [
    "servidor/api/romaneios/romaneios.php",
    "servidor/api/romaneios/importar_csv.php",
    "servidor/api/v1/romaneios-write.php",
    "servidor/src/Persistencia/RepositorioItensRomaneioSincronizacao.php",
  ]) {
    assert.match(read(path), /RepositorioItensRomaneio[\s\S]{0,500}?inserirLinhas\(/, path);
  }
  const csvItemGrouper = read("servidor/src/Aplicacao/AgrupadorItensImportacaoRomaneio.php");
  assert.match(csvItemGrouper, /romaneio_id[\s\S]+truck_id[\s\S]+product_id/);
  for (const path of [
    "servidor/src/Persistencia/RepositorioRomaneiosRemotos.php",
  ]) {
    const source = read(path);
    const inserts = [...source.matchAll(/INSERT INTO romaneio_itens\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/gs)];
    assert.ok(inserts.length > 0, `nenhuma inclusão encontrada em ${path}`);
    for (const [, columns, values] of inserts) {
      assert.match(columns, /\bcompany_id\b/, path);
      assert.match(values, /:company_id/, path);
    }
  }
  const synchronizationEndpoint = read("servidor/api/sincronizacao/sincronizacao_eventos.php");
  assert.match(synchronizationEndpoint, /new RepositorioItensRomaneioSincronizacao\(\$pdo\)/);
  assert.match(synchronizationEndpoint, /\$manifestItemsRepository->substituirItens\(/);
  const publicWrite = read("servidor/api/v1/romaneios-write.php");
  assert.match(publicWrite, /assigned_installation_company_id/);
});

test("buscas de código de barras usam o escopo e o índice da empresa", () => {
  const scanner = read("servidor/src/Persistencia/RepositorioLeituras.php");
  const manualLookup = read("servidor/api/operacoes/identificar_leitura.php");
  const products = read("servidor/api/produtos/produtos.php");
  const syncPayload = read("servidor/src/Persistencia/RepositorioPayloadSincronizacao.php");
  const manifestProducts = read("servidor/src/Persistencia/RepositorioProdutosRomaneio.php");
  const pdfImport = read("servidor/api/romaneios/importar_pdf.php");
  const manifests = read("servidor/api/romaneios/romaneios.php");
  const auditReport = read("servidor/api/relatorios/relatorio_auditoria.php");
  const barcodeIndex = read("banco-de-dados/migrations/023_codigo_barras_por_empresa.sql");

  assert.match(scanner, /WHERE pc\.company_id = :company_id\s+AND pc\.barcode = :barcode/);
  assert.match(read("servidor/api/operacoes/leituras.php"), /->buscarProdutoAtivoPorCodigo\(/);
  assert.match(manualLookup, /WHERE pc\.company_id = :company_id\s+AND pc\.barcode = :barcode/);
  assert.match(products, /LEFT JOIN codigos_produtos pc\s+ON pc\.company_id = p\.company_id AND pc\.product_id = p\.id/);
  assert.match(products, /pc\.company_id = p\.company_id AND pc\.product_id = p\.id AND pc\.barcode LIKE :search/);
  assert.match(syncPayload, /cp\.product_id = p\.id AND cp\.company_id = p\.company_id/);
  assert.match(manifestProducts, /WHERE pc\.company_id = :company_id AND p\.active = 1\s+AND pc\.barcode IN/);
  assert.match(pdfImport, /WHERE pc\.company_id = :company_id\s+AND pc\.barcode = :identifier/);
  assert.match(manifests, /WHERE pc\.company_id = p\.company_id AND pc\.product_id = p\.id/);
  assert.match(auditReport, /pc\.product_id = p\.id AND pc\.company_id = p\.company_id/);
  assert.match(barcodeIndex, /UNIQUE KEY uq_company_product_barcode \(company_id, barcode\)/);
});

test("correção de leitura manual valida o mesmo código, quantidade e estado do scanner", () => {
  const endpoint = read("servidor/api/operacoes/identificar_leitura.php");

  assert.match(endpoint, /pc\.barcode = :barcode/);
  assert.match(endpoint, /AND p\.id = :product_id/);
  assert.match(endpoint, /ClassificadorLeitura/);
  assert.match(endpoint, /obterQuantidadesParaClassificar\(/);
  assert.match(endpoint, /\["CARREGANDO", "PAUSADO"\]/);
  assert.match(endpoint, /LEITURA_IDENTIFICADA_MANUALMENTE/);
  assert.match(endpoint, /PRODUTO_INCORRETO/);
  assert.match(endpoint, /EXCESSO_DETECTADO/);
  assert.match(endpoint, /QUANTIDADE_PLANEJADA_ATINGIDA/);
  assert.match(endpoint, /state = 'FINALIZANDO'/);
  assert.match(endpoint, /event_uuid = :event_uuid AND company_id = :company_id/);
});

test("scanner recusa associação automática quando há mais de uma passagem candidata", () => {
  const endpoint = read("servidor/api/operacoes/leituras.php");

  assert.match(endpoint, /ORDER BY s\.detected_at DESC, s\.id DESC LIMIT 2 FOR UPDATE/);
  assert.match(endpoint, /\$pendingSensorIds = \$pendingSensor->fetchAll\(PDO::FETCH_COLUMN\)/);
  assert.match(endpoint, /count\(\$pendingSensorIds\) > 1/);
  assert.match(endpoint, /O código ficou no campo para você vinculá-lo à saca correta/);
});

test("relatório remove fontes locais depois de persistir as evidências no PDF final", () => {
  const auditReport = read("servidor/api/relatorios/relatorio_auditoria.php");
  const cleanupStart = auditReport.indexOf("function trace_cleanup_report_evidence");
  const cleanupEnd = auditReport.indexOf("\n$apiClient", cleanupStart);
  const cleanup = auditReport.slice(cleanupStart, cleanupEnd);

  assert.match(cleanup, /capture-\[0-9\]\+.*\\\.pdf/);
  assert.match(cleanup, /camera-pc\/request-/);
  assert.match(cleanup, /AND i\.reason <> 'NORMAL'/);
  assert.match(cleanup, /SET evidence_pdf_path = NULL/);
  const reportSaved = auditReport.indexOf("!chmod($temporaryReportPath, 0600) || !rename($temporaryReportPath, $reportPath)");
  const cleanupAfterSave = auditReport.indexOf("trace_cleanup_report_evidence($pdo, $loadIds", reportSaved);
  assert.ok(reportSaved >= 0 && cleanupAfterSave > reportSaved);
});

test("listagem de romaneios limita agregações à empresa antes de agrupar", () => {
  const source = read("servidor/src/Persistencia/RepositorioRomaneiosLista.php");

  assert.match(source, /WITH romaneios_paginados AS/);
  assert.match(source, /LIMIT :limit OFFSET :offset/);
  for (const relation of ["romaneio_itens", "leituras", "ocorrencias"]) {
    assert.match(source, new RegExp(`JOIN romaneios_paginados rp ON rp.id =`), relation);
  }
  assert.match(source, /r\.company_id = :company_id/);
  assert.match(source, /function contar\(/);
  assert.match(source, /function listar\(/);
});

test("limites da API são atômicos por chave e empresa, com resposta 429 documentada", () => {
  const bootstrap = read("servidor/api/v1/_bootstrap.php");
  const limiter = read("servidor/api/v1/_rate_limit.php");
  const migration = read("banco-de-dados/migrations/066_limites_api_v1_por_chave_empresa.sql");
  const openapi = read("servidor/api/v1/openapi.yaml");
  assert.match(bootstrap, /api_v1_aplicar_limite_requisicoes\(/);
  assert.match(limiter, /ON DUPLICATE KEY UPDATE/);
  assert.match(limiter, /limites_api_v1_empresa/);
  assert.match(limiter, /limites_api_v1_chave/);
  assert.match(limiter, /Retry-After/);
  assert.match(migration, /PRIMARY KEY \(api_key_id, request_class\)/);
  assert.match(migration, /PRIMARY KEY \(company_id, request_class\)/);
  assert.match(openapi, /RateLimited:/);
  assert.match(openapi, /Retry-After:/);
});

test("limite de erros do navegador não depende de contagem concorrente em logs_erros", () => {
  const endpoint = read("servidor/api/monitoramento/logs_erros.php");
  const migration = read("banco-de-dados/migrations/068_limite_logs_frontend.sql");
  const retention = read("scripts/prune_operational_data.php");
  assert.match(endpoint, /INSERT INTO limites_logs_frontend/);
  assert.match(endpoint, /ON DUPLICATE KEY UPDATE/);
  assert.match(endpoint, /fetchColumn\(\) > 30/);
  assert.ok(endpoint.indexOf("INSERT INTO limites_logs_frontend") < endpoint.indexOf("$duplicate->execute"));
  assert.doesNotMatch(endpoint, /SELECT COUNT\(\) FROM logs_erros[\s\S]{0,240}frontend\.%/);
  assert.match(migration, /limiter_key CHAR\(64\) NOT NULL PRIMARY KEY/);
  assert.match(retention, /limites_logs_frontend/);
});

test("o identificador primário é gerado pelo servidor e a origem fica preservada", () => {
  const observability = read("servidor/configuracao/observabilidade.php");
  const frontend = read("interface/js/utilitarios/LogFrontend.js");
  const endpoint = read("servidor/api/monitoramento/logs_erros.php");
  const logsScreen = read("interface/telas/logs-erros/logs-erros.js");
  assert.match(observability, /bin2hex\(random_bytes\(16\)\)/);
  assert.match(observability, /X-Request-ID/);
  assert.match(observability, /upstream_correlation_id/);
  assert.match(frontend, /correlation_id: novoIdentificadorCorrelacao\(\)/);
  assert.match(endpoint, /"correlation_id" => trace_correlation_id\(\)/);
  assert.match(endpoint, /"upstream_correlation_id"/);
  assert.match(logsScreen, /Rastreamento/);
});

test("chaves de idempotência exigidas têm retenção e documentação alinhadas", () => {
  const write = read("servidor/api/v1/romaneios-write.php");
  const openapi = read("servidor/api/v1/openapi.yaml");
  const docs = read("documentacao/integracoes/api-publica-v1.md");
  const retention = read("scripts/prune_operational_data.php");
  assert.match(write, /idempotency_key_required/);
  assert.match(openapi, /Idempotency-Key[\s\S]*required: true/);
  assert.match(docs, /obrigatoriamente uma `Idempotency-Key`/);
  assert.match(retention, /API_IDEMPOTENCY_RETENTION_DAYS/);
  assert.match(retention, /response_json IS NOT NULL/);
});
