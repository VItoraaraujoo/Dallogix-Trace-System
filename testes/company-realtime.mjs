import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompanyRealtimeController } from "../interface/js/controladores/company-realtime.js";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

function fixture(overrides = {}) {
  const calls = [];
  const errors = [];
  const cleared = [];
  let callback = null;
  let interval = null;
  let page = "company";
  let paused = false;
  let renders = 0;
  const store = {
    state: { selectedCompanyId: 7 },
    async loadCompanyDetail() {
      calls.push(Number(this.state.selectedCompanyId));
      if (overrides.loadCompanyDetail) return overrides.loadCompanyDetail.call(this);
    },
  };
  const controller = createCompanyRealtimeController({
    store,
    getPage: () => page,
    render: () => { renders += 1; },
    shouldPauseRefresh: () => paused,
    onError: (error) => errors.push(error),
    setIntervalFn: (next, delay) => {
      callback = next;
      interval = delay;
      return "company-refresh";
    },
    clearIntervalFn: (timer) => cleared.push(timer),
    ...overrides.controller,
  });
  return {
    controller,
    calls,
    errors,
    cleared,
    get callback() { return callback; },
    get interval() { return interval; },
    get renders() { return renders; },
    set page(value) { page = value; },
    set paused(value) { paused = value; },
    store,
  };
}

test("atualiza o detalhe da empresa e renderiza o heartbeat recente", async () => {
  const state = fixture();
  assert.equal(await state.controller.refresh(), true);
  assert.deepEqual(state.calls, [7]);
  assert.equal(state.renders, 1);
});

test("agenda uma única atualização de 15 segundos e a cancela ao sair da tela", () => {
  const state = fixture();
  state.controller.start();
  state.controller.start();
  assert.equal(state.interval, 15_000);
  state.controller.stop();
  state.controller.stop();
  assert.deepEqual(state.cleared, ["company-refresh"]);
});

test("não consulta fora da tela de empresa nem durante edição", async () => {
  const state = fixture();
  state.page = "companies";
  assert.equal(await state.controller.refresh(), false);
  state.page = "company";
  state.paused = true;
  assert.equal(await state.controller.refresh(), false);
  assert.deepEqual(state.calls, []);
});

test("evita consultas sobrepostas e descarta a renderização após trocar de empresa", async () => {
  let finish;
  const state = fixture({
    loadCompanyDetail() {
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  const first = state.controller.refresh();
  assert.equal(await state.controller.refresh(), false);
  state.store.state.selectedCompanyId = 8;
  finish();
  assert.equal(await first, false);
  assert.equal(state.renders, 0);
});

test("registra falha de atualização sem declarar o dado antigo como atualizado", async () => {
  const failure = new Error("servidor central indisponível");
  const state = fixture({
    loadCompanyDetail() { throw failure; },
  });
  assert.equal(await state.controller.refresh(), false);
  assert.deepEqual(state.errors, [failure]);
  assert.equal(state.renders, 0);
});

test("descarta resposta atrasada quando outra empresa é selecionada", async () => {
  const previousFetch = globalThis.fetch;
  let completeRequest;
  globalThis.fetch = () => new Promise((resolve) => { completeRequest = resolve; });
  try {
    const store = new ArmazenamentoTrace();
    store.selectCompany(7);
    const request = store.loadCompanyDetail();
    store.selectCompany(8);
    completeRequest({
      ok: true,
      json: async () => ({ data: { id: 7, name: "Empresa antiga" } }),
    });
    await request;
    assert.equal(store.state.companyDetail, null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
