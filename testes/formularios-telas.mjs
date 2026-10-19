import assert from "node:assert/strict";
import test from "node:test";
import { bindPageForms } from "../interface/js/controladores/formularios-telas.js";

function criarForm() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) { listeners.set(type, handler); },
    async dispatch(type) { return listeners.get(type)({ preventDefault() {} }); },
  };
}

function criarHarness({ one = {}, many = {}, store = {}, values = new Map() } = {}) {
  const calls = [];
  const notifications = [];
  const unauthorized = [];
  let renders = 0;
  const state = { configuration: { settings: { gateway_public_ip: "10.0.0.4" } } };
  const effectiveStore = {
    state,
    async createOccurrence(data) { calls.push(["createOccurrence", data]); },
    async saveConfiguration(data) { calls.push(["saveConfiguration", data]); },
    async applyManifestFilters(data) { calls.push(["applyManifestFilters", data]); },
    ...store,
  };
  const root = {
    querySelector(selector) { return one[selector] || null; },
    querySelectorAll(selector) { return many[selector] || []; },
  };
  bindPageForms({
    root,
    store: effectiveStore,
    render: () => { renders += 1; },
    notify: (message) => notifications.push(message),
    onUnauthorized: (...args) => unauthorized.push(args),
    readForm: (form) => values.get(form) || {},
  });
  return { calls, effectiveStore, notifications, unauthorized, get renders() { return renders; } };
}

test("ocorrência cria e redireciona quando a sessão expirou", async () => {
  const form = criarForm();
  const harness = criarHarness({
    one: { "#occurrence-form": form },
    values: new Map([[form, { type: "AVARIA", description: "Teste" }]]),
  });

  await form.dispatch("submit");
  assert.deepEqual(harness.calls, [["createOccurrence", { type: "AVARIA", description: "Teste" }]]);
  assert.equal(harness.renders, 1);

  const unauthorizedForm = criarForm();
  const expiredHarness = criarHarness({
    one: { "#occurrence-form": unauthorizedForm },
    store: { async createOccurrence() { const error = new Error("Sessão expirada"); error.status = 401; throw error; } },
  });
  await unauthorizedForm.dispatch("submit");
  assert.equal(expiredHarness.unauthorized.length, 1);
  assert.equal(expiredHarness.unauthorized[0][0].message, "Sessão expirada");
  assert.equal(expiredHarness.unauthorized[0][1], "ocorrencia");
});

test("salvar PDF preserva o IP salvo e ignora mapeamentos vazios", async () => {
  const form = criarForm();
  const harness = criarHarness({
    one: { "#pdf-settings-form": form },
    values: new Map([[form, {
      pdf_number: "numero_romaneio",
      pdf_date: "",
      pdf_search_field: "numero_romaneio",
      unrelated: "ignorar",
    }]]),
  });

  await form.dispatch("submit");

  assert.deepEqual(harness.calls, [["saveConfiguration", {
    gateway_public_ip: "10.0.0.4",
    pdf_field_mapping: { number: "numero_romaneio" },
    pdf_search_field: "numero_romaneio",
  }]]);
  assert.deepEqual(harness.notifications, ["Parâmetros salvos."]);
  assert.equal(harness.renders, 1);
});

test("filtros aplicam tanto no envio quanto na alteração", async () => {
  const form = criarForm();
  const harness = criarHarness({
    one: { "#manifest-filters": form },
    values: new Map([[form, { number: "R-15", status: "ATIVO" }]]),
  });

  await form.dispatch("change");
  await form.dispatch("submit");

  assert.deepEqual(harness.calls, [
    ["applyManifestFilters", { number: "R-15", status: "ATIVO" }],
    ["applyManifestFilters", { number: "R-15", status: "ATIVO" }],
  ]);
  assert.equal(harness.renders, 2);
});

test("busca de produto filtra linhas em memória sem consultar a API", () => {
  const input = {
    value: "parafuso",
    addEventListener(type, handler) { this.inputHandler = handler; },
  };
  const rows = [
    { textContent: "Parafuso zincado", style: {} },
    { textContent: "Porca sextavada", style: {} },
  ];
  const harness = criarHarness({
    one: { "#product-search": input },
    many: { ".table-wrap tbody tr": rows },
  });

  input.inputHandler();

  assert.deepEqual(rows.map((row) => row.style.display), ["", "none"]);
  assert.equal(harness.effectiveStore.state.productSearch, "parafuso");
  assert.equal(harness.calls.length, 0);
});
