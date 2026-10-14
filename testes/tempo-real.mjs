import assert from "node:assert/strict";
import { test } from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";
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

test("Emergência compartilha o stream sem reiniciar o ciclo e mostra o retorno do comando", async () => {
  const restaurar = criarAmbiente();
  let onData;
  let assinaturas = 0;
  let comandos = 0;
  let leiturasPendentes = 0;
  const telasAtualizadas = [];
  const frescor = [];
  const store = {
    state: { selectedLoadingId: 7, loadingId: 7 },
    subscribeOperationalEvents(callback) {
      assinaturas += 1;
      onData = callback;
      return { close() {} };
    },
    async applyActiveLoadingSnapshot() {},
    async loadPlcCommandStatus() { comandos += 1; },
    async loadPendingReadings() { leiturasPendentes += 1; },
  };
  const controller = createOperationalRealtimeController({
    store,
    getPage: () => "emergency",
    render() {},
    refreshWorkLiveView() {},
    refreshOtherLiveView: (page) => telasAtualizadas.push(page),
    setFreshness: (page, state) => frescor.push([page, state]),
    workStructureSignature: () => "estrutura",
    getViewSignature: () => "estrutura",
  });

  try {
    controller.start();
    controller.start();
    await onData({ active_loadings: [{ id: 7, equipment_id: 3, state: "EMERGENCIA" }] });
    assert.equal(assinaturas, 1);
    assert.equal(comandos, 1);
    assert.equal(leiturasPendentes, 0);
    assert.deepEqual(telasAtualizadas, ["emergency"]);
    assert.equal(frescor[0][0], "emergency");
    assert.equal(frescor[0][1].stale, false);
  } finally {
    controller.stop();
    restaurar();
  }
});

test("duas consultas operacionais falhas exibem dados desatualizados", async () => {
  const restaurar = criarAmbiente();
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  const timers = [];
  const frescor = [];
  window.setTimeout = (callback) => {
    timers.push(callback);
    return timers.length;
  };
  window.clearTimeout = () => {};
  const store = {
    state: { selectedLoadingId: 7, loadingId: 7 },
    subscribeOperationalEvents() { return { close() {} }; },
    async loadActiveLoading() { throw new Error("Gateway sem resposta"); },
    async loadMonitoring() {},
    async loadPendingReadings() {},
  };
  const controller = createOperationalRealtimeController({
    store,
    getPage: () => "work",
    render() {},
    refreshWorkLiveView() {},
    setFreshness: (page, state) => frescor.push([page, state]),
    workStructureSignature: () => "estrutura",
    getViewSignature: () => "estrutura",
  });

  try {
    controller.start();
    await timers.shift()();
    await timers.shift()();
    assert.equal(frescor.length, 2);
    assert.equal(frescor[0][1].stale, false);
    assert.equal(frescor[1][1].stale, true);
    assert.equal(frescor[1][1].consecutiveFailures, 2);
  } finally {
    controller.stop();
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
    restaurar();
  }
});

test("snapshot operacional enfileirado é descartado quando a página fica obsoleta", async () => {
  let liberarFila;
  let aplicado = false;
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.activeLoadingRefresh = new Promise((resolve) => { liberarFila = resolve; });
  armazenamento._applyActiveLoadingSnapshot = () => { aplicado = true; };
  const consulta = armazenamento.applyActiveLoadingSnapshot([], 7, () => false);
  liberarFila();
  await consulta;
  assert.equal(aplicado, false);
});

test("snapshot SSE anterior à consulta em curso não substitui dados mais novos", async () => {
  const restaurar = criarAmbiente();
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  const timers = [];
  window.setTimeout = (callback) => {
    timers.push(callback);
    return timers.length;
  };
  window.clearTimeout = () => {};

  let onData;
  let iniciarConsulta;
  let liberarConsulta;
  let snapshotsAplicados = 0;
  let comandosConsultados = 0;
  const consultaIniciada = new Promise((resolve) => { iniciarConsulta = resolve; });
  const consulta = new Promise((resolve) => { liberarConsulta = resolve; });
  const dadosAtuais = [{ id: 7, state: "CARREGANDO" }];
  const store = {
    state: {
      selectedLoadingId: 7,
      loadingId: 7,
      activeLoadings: [],
    },
    subscribeOperationalEvents(callback) {
      onData = callback;
      return { close() {} };
    },
    async loadActiveLoading() {
      iniciarConsulta();
      await consulta;
      this.state.activeLoadings = dadosAtuais;
    },
    async loadMonitoring() {},
    async loadPendingReadings() {},
    async loadPlcCommandStatus() { comandosConsultados += 1; },
    async applyActiveLoadingSnapshot() { snapshotsAplicados += 1; },
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
    const polling = timers.shift()();
    await consultaIniciada;
    await onData({
      sent_at: new Date(Date.now() - 5000).toISOString(),
      monitoring: { antigo: true },
      active_loadings: [{ id: 7, state: "PAUSADO" }],
    });
    assert.equal(snapshotsAplicados, 0);
    assert.equal(comandosConsultados, 1);
    liberarConsulta();
    await polling;
    assert.deepEqual(store.state.activeLoadings, dadosAtuais);
    assert.equal(store.state.monitoring, undefined);
  } finally {
    controller.stop();
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
    restaurar();
  }
});
