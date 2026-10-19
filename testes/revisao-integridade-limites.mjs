import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

const read = (path) => readFileSync(path, "utf8");

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
  const store = Object.create(ArmazenamentoTrace.prototype);
  store.state = {
    selectedCompanyId: 4,
    industrialInstallations: [],
    industrialEquipmentOptions: [],
  };
  const pages = [
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
  ];
  store.api = {
    fetch: async () => new Response(JSON.stringify(pages.shift()), { status: 200 }),
  };

  await store.loadIndustrialInstallations();

  assert.deepEqual(store.state.industrialInstallations, [{ id: 1, name: "PC 1" }]);
  assert.deepEqual(store.state.industrialEquipmentOptions, [
    { id: 10, name: "Dala 1" },
    { id: 11, name: "Dala 2" },
  ]);
});

test("a paginação de instalações falha com metadados ausentes em vez de truncar", async () => {
  const store = Object.create(ArmazenamentoTrace.prototype);
  store.state = {
    selectedCompanyId: 4,
    industrialInstallations: [],
    industrialEquipmentOptions: [],
  };
  store.api = {
    fetch: async () => new Response(JSON.stringify({
      data: { installations: [{ id: 1 }], equipment_options: [{ id: 10 }] },
      pagination: { has_more: false, next_cursor: null },
    }), { status: 200 }),
  };

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
  assert.match(client, /async fetchAllPages\(/);
  assert.match(client, /result\.pagination\?\.has_more/);
  assert.match(client, /next_cursor/);
  assert.match(client, /ultrapassa 10\.000 registros/);
  assert.match(client, /industrialEquipmentOptions = equipmentOptions/);
});

test("a migration recusa vínculos entre empresas antes de instalar chaves compostas", () => {
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
    "fk_api_idempotency_key_company",
    "fk_api_idempotency_romaneio_company",
    "trg_romaneios_installation_pair_insert_067",
    "trg_romaneios_installation_pair_update_067",
  ]) assert.ok(migration.includes(expected), `restrição ausente: ${expected}`);
});

test("todos os caminhos de inclusão de itens gravam a empresa no próprio registro", () => {
  const sources = [
    "servidor/api/romaneios/romaneios.php",
    "servidor/api/romaneios/importar_csv.php",
    "servidor/api/sincronizacao/sincronizacao_eventos.php",
    "servidor/api/v1/romaneios-write.php",
    "servidor/src/Aplicacao/ServicoSincronizacaoRemota.php",
  ];
  let insertCount = 0;
  for (const path of sources) {
    const source = read(path);
    const inserts = [...source.matchAll(/INSERT INTO romaneio_itens\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/gs)];
    assert.ok(inserts.length > 0, `nenhuma inclusão encontrada em ${path}`);
    for (const [, columns, values] of inserts) {
      insertCount += 1;
      assert.match(columns, /\bcompany_id\b/, path);
      assert.match(values, /:company_id/, path);
    }
  }
  assert.ok(insertCount >= 6, `esperava os caminhos de criação e importação; encontrei ${insertCount}`);
  const publicWrite = read("servidor/api/v1/romaneios-write.php");
  assert.match(publicWrite, /assigned_installation_company_id/);
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
