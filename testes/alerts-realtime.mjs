import assert from "node:assert/strict";
import { test } from "node:test";
import { createAlertsRealtimeController } from "../interface/js/controladores/alerts-realtime.js";
import { alerts } from "../interface/js/telas/monitoramento.js";

function fixture(overrides = {}) {
  const calls = [];
  const errors = [];
  const cleared = [];
  let callback = null;
  let interval = null;
  let page = "alerts";
  let renders = 0;
  const store = {
    state: { monitoringRefreshError: false, equipmentsError: "" },
    async loadMonitoring(options) { calls.push(["monitoring", options]); },
    async loadEquipments() { calls.push(["equipments"]); },
    async loadSyncStatus() { calls.push(["sync"]); },
    ...overrides.store,
  };
  const controller = createAlertsRealtimeController({
    store,
    getPage: () => page,
    render: () => { renders += 1; },
    onError: (error) => errors.push(error),
    setIntervalFn: (next, delay) => {
      callback = next;
      interval = delay;
      return "alerts-refresh";
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
    store,
  };
}

test("atualiza monitoramento e sincronização antes de renderizar", async () => {
  const state = fixture();
  state.store.state.monitoringRefreshError = true;

  assert.equal(await state.controller.refresh(), true);
  assert.deepEqual(state.calls, [
    ["monitoring", { requireSuccess: true }],
    ["sync"],
  ]);
  assert.equal(state.store.state.monitoringRefreshError, false);
  assert.equal(state.renders, 1);
});

test("agenda uma única atualização a cada 15 segundos e cancela ao sair", () => {
  const state = fixture();
  state.controller.start();
  state.controller.start();
  assert.equal(state.interval, 15_000);
  state.controller.stop();
  state.controller.stop();
  assert.deepEqual(state.cleared, ["alerts-refresh"]);
});

test("não consulta nem renderiza fora da tela de alertas", async () => {
  const state = fixture();
  state.page = "dashboard";

  assert.equal(await state.controller.refresh(), false);
  state.controller.start();
  assert.deepEqual(state.calls, []);
  assert.equal(state.interval, null);
});

test("evita chamadas simultâneas e descarta resposta após navegar", async () => {
  let finish;
  const state = fixture({
    store: {
      loadMonitoring() { return new Promise((resolve) => { finish = resolve; }); },
    },
  });
  const pending = state.controller.refresh();

  assert.equal(await state.controller.refresh(), false);
  state.page = "dashboard";
  finish();
  assert.equal(await pending, false);
  assert.equal(state.renders, 0);
});

test("mostra aviso desde a primeira falha e limpa quando a consulta recuperar", async () => {
  const failure = new Error("monitoramento indisponível");
  const state = fixture({ store: { loadMonitoring() { throw failure; } } });

  assert.equal(await state.controller.refresh(), false);
  assert.equal(state.store.state.monitoringRefreshError, true);
  assert.deepEqual(state.errors, [failure]);
  assert.equal(state.renders, 1);
  assert.match(
    alerts(state.store),
    /Os dados de monitoramento podem estar desatualizados/,
  );

  state.store.loadMonitoring = async () => {};
  assert.equal(await state.controller.refresh(), true);
  assert.equal(state.store.state.monitoringRefreshError, false);
});
