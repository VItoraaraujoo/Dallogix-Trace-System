import assert from "node:assert/strict";
import test from "node:test";
import { ServicoRomaneios } from "../interface/js/servicos/ServicoRomaneios.js";

function criarServico(overrides = {}) {
  const calls = [];
  const rows = [];
  const state = {
    manifestFilters: { date_from: "", date_to: "", number: "", expedidor: "", status: "" },
    manifestPage: 1,
    manifestMeta: { page: 1, per_page: 50, total: 0, pages: 0 },
    manifestDetail: null,
  };
  const responses = [...(overrides.responses || [])];
  const service = new ServicoRomaneios({
    api: {
      async fetch(url, options = {}) {
        calls.push({ url, options });
        return responses.shift() || { payload: { data: [] } };
      },
    },
    state,
    jsonHeaders: () => ({ "Content-Type": "application/json", "X-CSRF-Token": "csrf-test" }),
    jsonResponse: async (response) => {
      if (response.error) throw response.error;
      return response.payload;
    },
    getCsrfToken: () => overrides.csrfToken || "csrf-test",
    setManifestRows: (value) => { rows.splice(0, rows.length, ...value); },
  });
  return { calls, rows, state, service };
}

test("consulta romaneios aplica filtros e paginação e preserva metadados", async () => {
  const { calls, rows, state, service } = criarServico({
    responses: [{ payload: {
      data: [{ id: 7, number: "R-7" }],
      meta: { page: 2, per_page: 50, total: 51, pages: 2 },
    } }],
  });
  state.manifestFilters.number = "R 7";
  state.manifestPage = 2;

  await service.loadManifests();

  const query = new URL(calls[0].url, "http://trace.local").searchParams;
  assert.equal(query.get("number"), "R 7");
  assert.equal(query.get("page"), "2");
  assert.equal(query.get("per_page"), "50");
  assert.deepEqual(rows, [{ id: 7, number: "R-7" }]);
  assert.deepEqual(state.manifestMeta, { page: 2, per_page: 50, total: 51, pages: 2 });
});

test("aplicar e limpar filtros normaliza texto e retorna à primeira página", async () => {
  const { calls, state, service } = criarServico();
  state.manifestPage = 4;

  await service.applyFilters({ number: "  R-12 ", expedidor: "  Fazenda  " });
  assert.equal(state.manifestPage, 1);
  assert.equal(state.manifestFilters.number, "R-12");
  assert.equal(state.manifestFilters.expedidor, "Fazenda");

  await service.clearFilters();
  assert.equal(state.manifestPage, 1);
  assert.deepEqual(state.manifestFilters, {
    date_from: "", date_to: "", number: "", expedidor: "", status: "",
  });
  assert.equal(calls.length, 2);
});

test("paginação limita a página aos metadados carregados", async () => {
  const { calls, state, service } = criarServico();
  state.manifestMeta.pages = 3;

  await service.setPage(99);

  assert.equal(state.manifestPage, 3);
  assert.equal(new URL(calls[0].url, "http://trace.local").searchParams.get("page"), "3");
});

test("criar e editar preservam método, payload, retorno e recarga da lista", async () => {
  const created = { id: 9, number: "R-9" };
  const updated = { id: 9, number: "R-9A" };
  const { calls, service } = criarServico({
    responses: [
      { payload: { data: created } },
      { payload: { data: updated } },
      { payload: { data: [], meta: { page: 1, per_page: 50, total: 0, pages: 0 } } },
    ],
  });

  assert.deepEqual(await service.createManifest({ number: "R-9", items: [] }), created);
  assert.deepEqual(await service.updateManifest({ id: 9, number: "R-9A" }), updated);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { number: "R-9", items: [] });
  assert.equal(calls[1].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: "update", id: 9, number: "R-9A" });
  assert.equal(calls[2].url.startsWith("/api/romaneios.php?"), true);
});

test("detalhe e importação de PDF mantêm endpoint e token CSRF", async () => {
  const detail = { id: 4, number: "R-4" };
  const formData = { fixture: "pdf-form" };
  const { calls, state, service } = criarServico({
    responses: [{ payload: { data: detail } }, { payload: { data: { imported: 1 } } }],
  });

  await service.loadManifest(4);
  assert.deepEqual(state.manifestDetail, detail);
  assert.deepEqual(await service.importPdf(formData), { imported: 1 });
  assert.equal(calls[0].url, "/api/romaneios.php?id=4");
  assert.equal(calls[1].url, "/api/importar_pdf.php");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(calls[1].options.headers, { "X-CSRF-Token": "csrf-test" });
  assert.equal(calls[1].options.body, formData);
});
