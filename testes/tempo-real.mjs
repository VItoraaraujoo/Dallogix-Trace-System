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
