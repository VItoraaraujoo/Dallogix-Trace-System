import assert from "node:assert/strict";
import test from "node:test";
import {
  paradaPodeSerEnfileiradaAposInicio,
  paradaPodeSubstituirInicio,
  podeLiberarEmergencia,
} from "../interface/telas/operacao/operacao.js";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

test("parada pode substituir um início ainda pendente em pausa", () => {
  assert.equal(
    paradaPodeSubstituirInicio({
      state: "PAUSADO",
      pendingStatus: "PENDENTE",
      pendingCommand: "INICIAR_CARREGAMENTO",
    }),
    true,
  );
});

test("parada não substitui início já reservado pelo gateway", () => {
  assert.equal(
    paradaPodeSubstituirInicio({
      state: "PAUSADO",
      pendingStatus: "PROCESSANDO",
      pendingCommand: "INICIAR_CARREGAMENTO",
    }),
    false,
  );
});

test("parada fica disponível atrás de início já reservado pelo gateway", () => {
  assert.equal(
    paradaPodeSerEnfileiradaAposInicio({
      state: "CARREGANDO",
      pendingStatus: "PROCESSANDO",
      pendingCommand: "INICIAR_CARREGAMENTO",
    }),
    true,
  );
});

test("liberação de emergência fica disponível para os perfis operacionais", () => {
  for (const role of ["ADMIN_EMPRESA", "SUPERVISOR", "USUARIO"]) {
    assert.equal(podeLiberarEmergencia({ role, loadingId: 42 }), true);
  }
});

test("liberação de emergência não aparece sem carregamento selecionado", () => {
  assert.equal(podeLiberarEmergencia({ role: "USUARIO", loadingId: null }), false);
  assert.equal(podeLiberarEmergencia({ role: "ADMIN_DALLOGIX", loadingId: 42 }), false);
});

test("consulta transitória sem comando preserva início pendente local", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  const pedido = {
    id: 42,
    command: "INICIAR_CARREGAMENTO",
    status: "PENDENTE",
  };
  armazenamento.state = { plcCommand: pedido };
  armazenamento.api = { fetch: async () => ({ ok: true }) };
  armazenamento.jsonResponse = async () => ({ data: null });

  const resultado = await armazenamento._loadPlcCommandStatus(7);

  assert.deepEqual(resultado, pedido);
  assert.deepEqual(armazenamento.state.plcCommand, pedido);
});

test("comando de início atualiza o estado visível antes do ACK físico", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    operationalState: "PAUSADO",
    running: false,
    plcCommand: null,
    commandIntent: null,
  };
  armazenamento.api = {
    fetch: async () => ({ ok: true }),
  };
  armazenamento.jsonHeaders = () => ({ });
  armazenamento.jsonResponse = async () => ({
    data: {
      command_request_id: 42,
      command: "INICIAR_CARREGAMENTO",
      status: "PENDENTE",
      message: "Comando registrado",
    },
  });

  await armazenamento.requestMachineOperation("INICIAR_CARREGAMENTO", 7);

  assert.equal(armazenamento.state.operationalState, "CARREGANDO");
  assert.equal(armazenamento.state.running, true);
  assert.equal(armazenamento.state.commandIntent.id, 42);
});

test("comando rejeitado devolve o estado anterior", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    operationalState: "CARREGANDO",
    running: true,
    plcCommand: {
      id: 42,
      command: "PAUSAR_CARREGAMENTO",
      status: "PENDENTE",
    },
    commandIntent: {
      id: 42,
      loadingId: 7,
      command: "PAUSAR_CARREGAMENTO",
      status: "PENDENTE",
      previousState: "CARREGANDO",
    },
  };
  armazenamento.api = { fetch: async () => ({ ok: true }) };
  armazenamento.jsonResponse = async () => ({
    data: {
      id: 42,
      command: "PAUSAR_CARREGAMENTO",
      status: "REJEITADO",
      response_message: "Intertravamento ativo",
    },
  });
  armazenamento.commandStatusRefresh = Promise.resolve();

  await armazenamento._loadPlcCommandStatus(7);

  assert.equal(armazenamento.state.operationalState, "CARREGANDO");
  assert.equal(armazenamento.state.commandIntent, null);
});

test("quadro vazio não apaga a Dala durante comando operacional pendente", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  const carregamento = {
    id: 7,
    state: "PREPARANDO",
    equipment_id: 3,
    equipment_code: "EST-001",
  };
  armazenamento.state = {
    loadingId: 7,
    selectedLoadingId: 7,
    activeLoadings: [carregamento],
    loadingItems: [],
    plcCommand: {
      id: 42,
      command: "INICIAR_CARREGAMENTO",
      status: "PENDENTE",
    },
    commandInFlight: false,
  };

  const resultado = await armazenamento._applyActiveLoadingSnapshot([], 7);

  assert.deepEqual(resultado, carregamento);
  assert.equal(armazenamento.state.loadingId, 7);
  assert.equal(armazenamento.state.selectedLoadingId, 7);
  assert.deepEqual(armazenamento.state.activeLoadings, [carregamento]);
});

test("quadro vazio remove a seleção quando não há comando pendente", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    selectedLoadingId: 7,
    activeLoadings: [{ id: 7, state: "CARREGANDO", equipment_id: 3 }],
    loadingItems: [{ product_id: 1 }],
    plcCommand: { id: 42, command: "INICIAR_CARREGAMENTO", status: "APLICADO" },
    commandInFlight: false,
  };

  const resultado = await armazenamento._applyActiveLoadingSnapshot([], 7);

  assert.equal(resultado, null);
  assert.equal(armazenamento.state.loadingId, null);
  assert.equal(armazenamento.state.selectedLoadingId, null);
  assert.deepEqual(armazenamento.state.activeLoadings, []);
});
