import assert from "node:assert/strict";
import test from "node:test";
import { criarTratadorAcoesNavegacao } from "../interface/js/controladores/acoes-navegacao.js";

function prepararNavegacao(overrides = {}) {
  const calls = [];
  const store = { state: { selectedLoadingId: null } };
  const deps = {
    navegar: (...args) => {
      calls.push(args);
    },
    paginaAtual: () => "manifests",
    buscaAtual: () => "",
    store,
    estaVoltandoAoDashboard: () => false,
    consultaRetornoDashboard: () => "",
    paginaDeRetorno: () => "dalas",
    idDaConsulta: () => "42",
    ...overrides,
  };
  return { calls, store, tratar: criarTratadorAcoesNavegacao(deps) };
}

test("ações de navegação resolvem destinos de empresas e módulos", () => {
  const { calls, tratar } = prepararNavegacao({
    paginaAtual: () => "company",
    buscaAtual: () => "?from=master-home",
  });

  for (const [action, node, expected] of [
    ["open-company", { dataset: { id: "7" } }, ["company", "?id=7&from=company"]],
    ["back-companies", { dataset: {} }, ["master-home"]],
    ["back-settings", { dataset: {} }, ["settings"]],
    ["back-company", { dataset: { companyId: "8" } }, ["company", "?id=8&from=companies"]],
    ["open-users", { dataset: { companyId: "9" } }, ["users", "?company_id=9&from=company"]],
    ["goto-dalas", { dataset: {} }, ["dalas"]],
    ["goto-companies", { dataset: {} }, ["companies"]],
    ["goto-error-logs", { dataset: {} }, ["error-logs"]],
  ]) {
    assert.equal(tratar(action, node), true, action);
    assert.deepEqual(calls.at(-1), expected, action);
  }
});

test("ações do romaneio preservam contexto e identificadores", () => {
  const { calls, tratar } = prepararNavegacao({
    paginaAtual: () => "dashboard",
    buscaAtual: () => "?from=dashboard",
    estaVoltandoAoDashboard: () => true,
  });

  const cases = [
    ["goto-manifests", {}, ["dashboard"]],
    ["new-manifest", {}, ["import"]],
    ["view-manifest", { id: "11" }, ["manifest", "?id=11&from=dashboard"]],
    ["edit-manifest", { id: "12" }, ["manifest-edit", "?id=12"]],
    ["prepare-manifest", { id: "a b" }, ["division", "?id=a%20b&from=dashboard"]],
    ["back-manifest", {}, ["manifest", "?id=42&from=dashboard"]],
  ];

  for (const [action, dataset, expected] of cases) {
    assert.equal(tratar(action, { dataset }), true, action);
    assert.deepEqual(calls.at(-1), expected, action);
  }
});

test("ações de Dala mantêm seleção e página de retorno", async () => {
  const { calls, store, tratar } = prepararNavegacao({ paginaDeRetorno: () => "dashboard" });

  assert.equal(tratar("view-dala", { dataset: { id: "3" } }), true);
  assert.deepEqual(calls.at(-1), ["dala", "?id=3&from=dashboard"]);
  assert.equal(tratar("edit-dala", { dataset: { id: "3" } }), true);
  assert.deepEqual(calls.at(-1), ["dala-edit", "?id=3&from=dashboard"]);
  assert.equal(tratar("back-dala", { dataset: {} }), true);
  assert.deepEqual(calls.at(-1), ["dashboard"]);

  assert.equal(tratar("resume-loading", { dataset: { loadingId: "14" } }), true);
  assert.equal(store.state.selectedLoadingId, 14);
  assert.deepEqual(calls.at(-1), ["work", ""]);
  assert.equal(await tratar("open-dala-operation", { dataset: { loadingId: "15" } }), true);
  assert.equal(store.state.selectedLoadingId, 15);
  assert.deepEqual(calls.at(-1), ["work"]);
});

test("navegação que antes aguardava continua aguardando e ações alheias não são consumidas", async () => {
  let concluida = false;
  const { tratar } = prepararNavegacao({
    navegar: async () => {
      await Promise.resolve();
      concluida = true;
    },
  });

  const pending = tratar("back-work", { dataset: {} });
  assert.equal(concluida, false);
  await pending;
  assert.equal(concluida, true);
  assert.equal(tratar("cancel-manifest", { dataset: {} }), false);
  assert.equal(tratar("unknown-action", { dataset: {} }), false);
});
