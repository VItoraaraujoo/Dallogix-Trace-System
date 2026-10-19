import assert from "node:assert/strict";
import test from "node:test";
import { criarTratadorAcoesOperacionais } from "../interface/js/controladores/acoes-operacionais.js";

function prepararControlador(overrides = {}) {
  const calls = {
    notifications: [],
    confirmations: [],
    prompts: [],
    navigation: [],
    renders: 0,
    warnings: [],
    commands: [],
    pendingPages: [],
    activeLoads: [],
    deviceStatuses: [],
    finish: [],
    feedbackSnapshots: [],
  };
  const store = {
    state: {
      pendingReadingsPages: 3,
      operationalState: "FINALIZADO",
      loaded: 5,
      planned: 5,
      manifestDetail: { status: "EM_ANDAMENTO", active_loading_id: 18 },
    },
    loadPendingReadings: async (page) => calls.pendingPages.push(page),
    cancelManifest: async (id, reason) => ({ id, reason, status: "CANCELADO" }),
    loadActiveLoading: async (id) => calls.activeLoads.push(id),
    loadDeviceStatuses: async () => calls.deviceStatuses.push("loaded"),
    finishLoading: async (justification) => calls.finish.push(justification),
  };
  const storeAtual = overrides.store || store;
  const dependencies = {
    store: storeAtual,
    render: () => {
      calls.renders += 1;
      calls.feedbackSnapshots.push(
        storeAtual.state.manifestActionFeedback
          ? { ...storeAtual.state.manifestActionFeedback }
          : null,
      );
    },
    navegar: async (page) => calls.navigation.push(page),
    paginaAtual: () => "work",
    estaVoltandoAoDashboard: () => false,
    idDaConsulta: () => "manifest-4",
    solicitarTexto: async (message) => {
      calls.prompts.push(message);
      return "motivo de teste";
    },
    confirmarAcao: async (message) => {
      calls.confirmations.push(message);
      return true;
    },
    notificar: (...args) => calls.notifications.push(args),
    notificarForaDaOperacao: (...args) => calls.notifications.push(args),
    registrarAviso: (...args) => calls.warnings.push(args),
    servicoEmergencia: { liberar: async () => {} },
    executarComandoDeOperacao: async (...args) => calls.commands.push(args),
    changeOperationLoading: async (...args) => calls.activeLoads.push(["change", ...args]),
    ...overrides,
  };

  return {
    calls,
    store: storeAtual,
    tratar: criarTratadorAcoesOperacionais(dependencies),
  };
}

test("página de leituras pendentes valida o destino e sempre libera o botão conectado", async () => {
  const { calls, tratar } = prepararControlador();
  const node = { dataset: { page: "2", busy: "0" }, disabled: false, isConnected: true };

  await tratar("pending-readings-page", node);

  assert.deepEqual(calls.pendingPages, [2]);
  assert.equal(node.dataset.busy, "0");
  assert.equal(node.disabled, false);
  assert.equal(calls.renders, 1);

  node.dataset.page = "4";
  await tratar("pending-readings-page", node);
  assert.deepEqual(calls.pendingPages, [2]);
});

test("seleção de Dala carrega o status e limpa a seleção quando a API falha", async () => {
  const { calls, store, tratar } = prepararControlador({
    store: {
      state: { commandFeedback: "", selectedLoadingId: 7 },
      loadActiveLoading: async () => { throw new Error("Dala indisponível"); },
      loadDeviceStatuses: async () => {},
    },
  });

  await tratar("select-loading", { dataset: { id: "9" } });

  assert.equal(store.state.selectedLoadingId, null);
  assert.equal(store.state.commandFeedback, "Dala indisponível");
  assert.equal(calls.renders, 1);
});

test("seleção de Dala atualiza só o status dos dispositivos, sem buscar o snapshot completo", async () => {
  const { calls, tratar } = prepararControlador();

  await tratar("select-loading", { dataset: { id: "9" } });

  assert.deepEqual(calls.activeLoads, ["9"]);
  assert.deepEqual(calls.deviceStatuses, ["loaded"]);
  assert.equal(calls.renders, 1);
});

test("cancelamento da operação preserva feedback e limpa o carregamento ativo", async () => {
  const { calls, store, tratar } = prepararControlador();
  store.cancelManifest = async () => ({ status: "CANCELADO" });

  await tratar("cancel-manifest-progress", { dataset: { id: "manifest-4" } });

  assert.equal(store.state.manifestActionPending, false);
  assert.equal(store.state.manifestDetail.status, "CANCELADO");
  assert.equal(store.state.manifestDetail.active_loading_id, null);
  assert.deepEqual(calls.feedbackSnapshots.at(-1), {
    type: "success",
    message: "Operação cancelada e registrada na auditoria.",
  });
  assert.deepEqual(calls.navigation, ["manifests"]);
  assert.equal(store.state.manifestActionFeedback, null);
});

test("falha ao cancelar permanece visível e não navega", async () => {
  const { calls, store, tratar } = prepararControlador({
    store: {
      state: { manifestActionPending: false, manifestActionFeedback: null },
      cancelManifest: async () => { throw new Error("Não foi possível cancelar."); },
    },
  });

  await tratar("cancel-manifest-progress", { dataset: {} });

  assert.equal(store.state.manifestActionPending, false);
  assert.deepEqual(store.state.manifestActionFeedback, {
    type: "error",
    message: "Não foi possível cancelar.",
  });
  assert.deepEqual(calls.navigation, []);
});

test("finalização pede justificativa apenas quando há divergência", async () => {
  const { calls, store, tratar } = prepararControlador();
  store.state.loaded = 3;
  store.state.planned = 5;

  await tratar("finish", { dataset: {} });

  assert.deepEqual(calls.finish, ["motivo de teste"]);
  assert.equal(calls.renders, 1);
});

test("emergência restaura o botão após falha e comandos são encaminhados uma vez", async () => {
  const { calls, tratar } = prepararControlador({
    servicoEmergencia: { liberar: async () => { throw new Error("Gateway indisponível"); } },
  });
  const node = { disabled: false };

  await tratar("unlock", node);
  await tratar("reverse-on", node);

  assert.equal(node.disabled, false);
  assert.deepEqual(calls.notifications, [["Gateway indisponível", "erro"]]);
  assert.deepEqual(calls.commands, [[node, "reverse-on"]]);
  assert.equal(tratar("ação-desconhecida", node), false);
});

test("cancelamento simples exige as duas confirmações e retorna à origem", async () => {
  const { calls, tratar } = prepararControlador({
    estaVoltandoAoDashboard: () => true,
  });

  await tratar("cancel-manifest", { dataset: { id: "manifest-4" } });

  assert.equal(calls.confirmations.length, 2);
  assert.deepEqual(calls.navigation, ["dashboard"]);
  assert.deepEqual(calls.notifications, [["Romaneio cancelado."]]);
});
