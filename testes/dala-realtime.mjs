import assert from "node:assert/strict";
import { test } from "node:test";
import { createDalaRealtimeController } from "../interface/js/controladores/dala-realtime.js";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

function fixture(overrides = {}) {
  const calls = [];
  const errors = [];
  const cleared = [];
  let callback = null;
  let interval = null;
  let page = "dala";
  let equipmentId = "4";
  let renders = 0;
  const store = {
    async loadEquipment(id) { calls.push(["equipment", id]); },
    async loadMonitoring() { calls.push(["monitoring"]); },
    async loadDalaCommandHistory(id) { calls.push(["commands", id]); },
    ...overrides.store,
  };
  const controller = createDalaRealtimeController({
    store,
    getPage: () => page,
    getEquipmentId: () => equipmentId,
    render: () => { renders += 1; },
    onError: (error) => errors.push(error),
    setIntervalFn: (next, delay) => {
      callback = next;
      interval = delay;
      return "dala-refresh";
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
    set equipmentId(value) { equipmentId = value; },
    store,
  };
}

test("atualiza cadastro, monitoramento e comandos da Dala antes de renderizar", async () => {
  const state = fixture();
  assert.equal(await state.controller.refresh(), true);
  assert.deepEqual(state.calls, [
    ["equipment", 4],
    ["monitoring"],
    ["commands", 4],
  ]);
  assert.equal(state.renders, 1);
});

test("agenda uma única atualização de 15 segundos e cancela ao sair", () => {
  const state = fixture();
  state.controller.start();
  state.controller.start();
  assert.equal(state.interval, 15_000);
  state.controller.stop();
  state.controller.stop();
  assert.deepEqual(state.cleared, ["dala-refresh"]);
});

test("não consulta fora do detalhe da Dala nem sem identificador válido", async () => {
  const state = fixture();
  state.page = "dalas";
  assert.equal(await state.controller.refresh(), false);
  state.page = "dala";
  state.equipmentId = "invalido";
  assert.equal(await state.controller.refresh(), false);
  assert.deepEqual(state.calls, []);
});

test("evita sobreposição e descarta a renderização após mudar de página", async () => {
  let finish;
  const state = fixture({
    store: {
      loadEquipment() {
        return new Promise((resolve) => { finish = resolve; });
      },
    },
  });
  const first = state.controller.refresh();
  assert.equal(await state.controller.refresh(), false);
  state.page = "dalas";
  finish();
  assert.equal(await first, false);
  assert.equal(state.renders, 0);
});

test("não renderiza dado antigo se uma consulta falhar", async () => {
  const failure = new Error("monitoramento indisponível");
  const state = fixture({
    store: { loadMonitoring() { throw failure; } },
  });
  assert.equal(await state.controller.refresh(), false);
  assert.deepEqual(state.errors, [failure]);
  assert.equal(state.renders, 0);
});

test("resposta de uma Dala antiga não substitui o detalhe selecionado mais novo", async () => {
  const previousFetch = globalThis.fetch;
  const pending = new Map();
  globalThis.fetch = (url) => {
    const id = Number(new URL(url, "http://localhost").searchParams.get("id"));
    return new Promise((resolve) => { pending.set(id, resolve); });
  };
  try {
    const store = new ArmazenamentoTrace();
    const older = store.loadEquipment(7);
    const newer = store.loadEquipment(8);
    pending.get(8)({
      ok: true,
      json: async () => ({ data: { id: 8, name: "Dala atual" } }),
    });
    await newer;
    pending.get(7)({
      ok: true,
      json: async () => ({ data: { id: 7, name: "Dala antiga" } }),
    });
    await older;
    assert.equal(store.state.equipmentDetail.id, 8);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("monitoramento HTTP com falha não é aceito como atualização bem-sucedida", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ error: "monitoramento indisponível" }),
  });
  try {
    const store = new ArmazenamentoTrace();
    store.state.monitoring = { previous: true };
    await assert.rejects(
      store.loadMonitoring({ requireSuccess: true }),
      /monitoramento indisponível/,
    );
    assert.deepEqual(store.state.monitoring, { previous: true });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
