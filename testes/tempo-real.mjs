import assert from "node:assert/strict";
import { test } from "node:test";
import { createOperationalRealtimeController } from "../interface/js/controladores/tempo-real.js";

function criarAmbiente() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = {
    setTimeout,
    clearTimeout,
  };
  globalThis.document = { hidden: false };
  return () => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  };
}

test("evento que termina depois da navegação não sobrescreve a tela atual", async () => {
  const restaurar = criarAmbiente();
  let pagina = "work";
  let onData;
  let fecharamEvento = false;
  let iniciarSnapshot;
  let resolverSnapshot;
  let chamadasDeStatus = 0;
  let renderizacoes = 0;
  const snapshotIniciado = new Promise((resolve) => { iniciarSnapshot = resolve; });
  const snapshot = new Promise((resolve) => { resolverSnapshot = resolve; });
  const store = {
    state: {
      selectedLoadingId: 7,
      loadingId: 7,
      monitoring: { antigo: true },
    },
    subscribeOperationalEvents(callback) {
      onData = callback;
      return { close() { fecharamEvento = true; } };
    },
    async applyActiveLoadingSnapshot() {
      iniciarSnapshot();
      await snapshot;
    },
    async loadPlcCommandStatus() { chamadasDeStatus += 1; },
    async loadPendingReadings() {},
  };
  const controller = createOperationalRealtimeController({
    store,
    getPage: () => pagina,
    render: () => { renderizacoes += 1; },
    refreshWorkLiveView: () => { renderizacoes += 1; },
    workStructureSignature: () => "estrutura",
    getViewSignature: () => "estrutura",
  });

  try {
    controller.start();
    const evento = onData({
      monitoring: { novo: true },
      active_loadings: [{ id: 7, equipment_id: 3, state: "CARREGANDO" }],
    });
    await snapshotIniciado;
    pagina = "settings";
    controller.stop();
    resolverSnapshot();
    await evento;

    assert.equal(fecharamEvento, true);
    assert.deepEqual(store.state.monitoring, { antigo: true });
    assert.equal(chamadasDeStatus, 0);
    assert.equal(renderizacoes, 0);
  } finally {
    restaurar();
  }
});

test("evento obsoleto não aplica snapshot depois da consulta de confirmação", async () => {
  const restaurar = criarAmbiente();
  let pagina = "work";
  let onData;
  let iniciarConsulta;
  let resolverConsulta;
  let snapshotsAplicados = 0;
  const consultaIniciada = new Promise((resolve) => { iniciarConsulta = resolve; });
  const consulta = new Promise((resolve) => { resolverConsulta = resolve; });
  const store = {
    state: {
      selectedLoadingId: 7,
      loadingId: 7,
      activeLoadings: [{ id: 7, equipment_id: 3, state: "CARREGANDO" }],
    },
    subscribeOperationalEvents(callback) {
      onData = callback;
      return { close() {} };
    },
    async loadActiveLoading() {
      iniciarConsulta();
      await consulta;
      this.state.activeLoadings = [];
      this.state.loadingId = null;
    },
    async applyActiveLoadingSnapshot() { snapshotsAplicados += 1; },
  };
  const controller = createOperationalRealtimeController({
    store,
    getPage: () => pagina,
    render() {},
    refreshWorkLiveView() {},
    workStructureSignature: () => "estrutura",
    getViewSignature: () => "estrutura",
  });

  try {
    controller.start();
    const evento = onData({ active_loadings: [] });
    await consultaIniciada;
    pagina = "settings";
    controller.stop();
    resolverConsulta();
    await evento;

    assert.equal(snapshotsAplicados, 0);
  } finally {
    restaurar();
  }
});

test("quadro vazio do stream confirma a operação antes de limpar a tela", async () => {
  const restaurar = criarAmbiente();
  let onData;
  let snapshotAplicado;
  const store = {
    state: {
      selectedLoadingId: 7,
      loadingId: 7,
      activeLoadings: [{ id: 7, equipment_id: 3, state: "CARREGANDO" }],
    },
    subscribeOperationalEvents(callback) {
      onData = callback;
      return { close() {} };
    },
    async loadActiveLoading(id) {
      assert.equal(id, 7);
      this.state.activeLoadings = [{ id: 7, equipment_id: 3, state: "CARREGANDO" }];
    },
    async applyActiveLoadingSnapshot(loadings) {
      snapshotAplicado = loadings;
    },
    async loadPlcCommandStatus() {},
    async loadPendingReadings() {},
  };
  const controller = createOperationalRealtimeController({
    store,
    getPage: () => "work",
    render() {},
    refreshWorkLiveView() {},
    workStructureSignature: () => "estrutura",
    getViewSignature: () => "estrutura",
  });

  try {
    controller.start();
    await onData({ active_loadings: [] });
    assert.deepEqual(snapshotAplicado, store.state.activeLoadings);
  } finally {
    controller.stop();
    restaurar();
  }
});

test("quadro vazio confirmado permite limpar uma operação encerrada", async () => {
  const restaurar = criarAmbiente();
  let onData;
  let snapshotAplicado;
  const store = {
    state: {
      selectedLoadingId: 7,
      loadingId: 7,
      activeLoadings: [{ id: 7, equipment_id: 3, state: "CARREGANDO" }],
    },
    subscribeOperationalEvents(callback) {
      onData = callback;
      return { close() {} };
    },
    async loadActiveLoading() {
      this.state.selectedLoadingId = null;
      this.state.loadingId = null;
      this.state.activeLoadings = [];
    },
    async applyActiveLoadingSnapshot(loadings) {
      snapshotAplicado = loadings;
    },
    async loadPlcCommandStatus() {},
    async loadPendingReadings() {},
  };
  const controller = createOperationalRealtimeController({
    store,
    getPage: () => "work",
    render() {},
    refreshWorkLiveView() {},
    workStructureSignature: () => "estrutura",
    getViewSignature: () => "estrutura",
  });

  try {
    controller.start();
    await onData({ active_loadings: [] });
    assert.deepEqual(snapshotAplicado, []);
  } finally {
    controller.stop();
    restaurar();
  }
});

test("mantém polling quando o stream SSE conecta", async () => {
  const restaurar = criarAmbiente();
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  let agendado = null;
  let consultas = 0;
  window.setTimeout = (callback) => {
    agendado = callback;
    return 1;
  };
  window.clearTimeout = () => {};
  const store = {
    state: { selectedLoadingId: 7, loadingId: 7 },
    subscribeOperationalEvents() {
      return { close() {} };
    },
    async loadActiveLoading() { consultas += 1; },
    async loadMonitoring() {},
    async loadPendingReadings() {},
  };
  const controller = createOperationalRealtimeController({
    store,
    getPage: () => "work",
    render() {},
    refreshWorkLiveView() {},
    workStructureSignature: () => "estrutura",
    getViewSignature: () => "estrutura",
  });

  try {
    controller.start();
    assert.equal(typeof agendado, "function");
    await agendado();
    assert.equal(consultas, 1);
  } finally {
    controller.stop();
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
    restaurar();
  }
});
