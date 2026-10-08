import assert from "node:assert/strict";
import test from "node:test";
import {
  paradaPodeSerEnfileiradaAposInicio,
  paradaPodeSubstituirInicio,
  podeLiberarEmergencia,
  workControlLocks,
  work,
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

test("comandos permanecem visíveis e direção fica bloqueada em emergência ou finalização", () => {
  for (const operationalState of ["FINALIZADO", "EMERGENCIA"]) {
    const markup = work({
      state: {
        selectedLoadingId: 7,
        loadingId: 7,
        activeLoadings: [{ id: 7, state: operationalState, equipment_id: 3 }],
        loadingItems: [{ name: "Produto", code: "SKU-1", loaded_quantity: 0, planned_quantity: 1 }],
        equipmentCode: "EST-001",
        romaneio: "7",
        truck: "ABC1234",
        operationalState,
        detectedBags: 0,
        planned: 1,
        loaded: 0,
        userRole: "usuario",
        commandInFlight: false,
        emergency: operationalState === "EMERGENCIA",
        pendingReadings: [],
      },
    });
    for (const label of ["Ligar esteira", "Desligar esteira", "Ligar reversão", "Desligar reversão", "EMERGÊNCIA"]) {
      assert.match(markup, new RegExp(label));
    }
    assert.match(markup, /data-action="run"[^>]*disabled/);
    assert.match(markup, /data-action="reverse-on"[^>]*disabled/);
    assert.match(markup, /data-action="emergency"(?![^>]*disabled)/);
    assert.doesNotMatch(markup, /Última comunicação/);
    assert.doesNotMatch(markup, /Sensor|Scanner|Câmera|Servidor/);
  }
});

test("falha do comando aparece na tela de operação com mensagem escapada", () => {
  const markup = work({
    state: {
      selectedLoadingId: 7,
      loadingId: 7,
      activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
      loadingItems: [],
      equipmentCode: "EST-001",
      romaneio: "7",
      truck: "ABC1234",
      operationalState: "PAUSADO",
      detectedBags: 0,
      planned: 1,
      loaded: 0,
      userRole: "USUARIO",
      commandInFlight: false,
      commandFeedback: "Falha <script>alert(1)</script>",
      pendingReadings: [],
    },
  });

  assert.match(markup, /class="work-command-error" role="alert"/);
  assert.match(markup, /Falha &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>alert\(1\)<\/script>/);
});

test("erro final do gateway fica visível na tela de operação", () => {
  const markup = work({
    state: {
      selectedLoadingId: 7,
      loadingId: 7,
      activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
      loadingItems: [],
      equipmentCode: "EST-001",
      romaneio: "7",
      truck: "ABC1234",
      operationalState: "PAUSADO",
      detectedBags: 0,
      planned: 1,
      loaded: 0,
      userRole: "USUARIO",
      commandInFlight: false,
      plcCommand: {
        command: "INICIAR_CARREGAMENTO",
        status: "ERRO",
        response_message: "Tempo limite Modbus; estado físico não confirmado.",
      },
      pendingReadings: [],
    },
  });

  assert.match(markup, /Tempo limite Modbus; estado físico não confirmado\./);
  assert.match(markup, /class="work-command-error" role="alert"/);
});

test("início pendente deixa a parada e a emergência disponíveis", () => {
  const markup = work({
    state: {
      selectedLoadingId: 7,
      loadingId: 7,
      activeLoadings: [{ id: 7, state: "CARREGANDO", equipment_id: 3 }],
      loadingItems: [],
      equipmentCode: "EST-001",
      romaneio: "7",
      truck: "ABC1234",
      operationalState: "CARREGANDO",
      detectedBags: 0,
      planned: 1,
      loaded: 0,
      userRole: "USUARIO",
      commandInFlight: true,
      plcCommand: { command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
      commandIntent: { command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
      emergency: false,
      pendingReadings: [],
    },
  });
  for (const action of ["run", "stop", "reverse-on", "reverse-off"]) {
    assert.match(markup, new RegExp(`data-action="${action}"`));
  }
  assert.match(markup, /data-action="stop"(?![^>]*disabled)/);
  assert.match(markup, /data-action="emergency"(?![^>]*disabled)/);
  assert.match(markup, /data-action="run"[^>]*disabled/);
  assert.match(markup, /data-action="reverse-on"[^>]*disabled/);
  assert.match(markup, /Iniciar carregamento · aguardando CLP/);
});

test("esteira parada libera iniciar e ligar reversão, mas não oferece parada redundante", () => {
  const locks = workControlLocks({
    loadingId: 7,
    operationalState: "PAUSADO",
    reversalCommand: "REVERSAO_DESATIVAR",
    userRole: "USUARIO",
  });
  assert.equal(locks.run, "");
  assert.equal(locks.stop, "A esteira já está parada.");
  assert.equal(locks["reverse-on"], "");
  assert.equal(locks["reverse-off"], "A reversão já está desligada.");
});

test("esteira em movimento deixa disponível somente parar entre os comandos normais", () => {
  const locks = workControlLocks({
    loadingId: 7,
    operationalState: "CARREGANDO",
    running: true,
    reversalCommand: "REVERSAO_DESATIVAR",
    userRole: "USUARIO",
  });
  assert.notEqual(locks.run, "");
  assert.equal(locks.stop, "");
  assert.notEqual(locks["reverse-on"], "");
  assert.notEqual(locks["reverse-off"], "");
});

test("parada pendente aguarda o CLP antes de liberar nova direção", () => {
  const locks = workControlLocks({
    loadingId: 7,
    operationalState: "PAUSADO",
    plcCommand: { command: "PAUSAR_CARREGAMENTO", status: "PENDENTE" },
    commandIntent: { command: "PAUSAR_CARREGAMENTO", status: "PENDENTE" },
    reversalCommand: "REVERSAO_DESATIVAR",
    userRole: "USUARIO",
  });
  assert.notEqual(locks.run, "");
  assert.notEqual(locks.stop, "");
  assert.notEqual(locks["reverse-on"], "");
  assert.notEqual(locks["reverse-off"], "");
});

test("quando a reversão está ativa, só ficam disponíveis desligar reversão e emergência", () => {
  const locks = workControlLocks({
    loadingId: 7,
    operationalState: "PAUSADO",
    reversalCommand: "REVERSAO_ATIVAR",
    userRole: "USUARIO",
  });
  assert.notEqual(locks.run, "");
  assert.notEqual(locks.stop, "");
  assert.notEqual(locks["reverse-on"], "");
  assert.equal(locks["reverse-off"], "");
});

test("romaneio finalizado não bloqueia comandos por seu status, somente o estado da máquina", () => {
  const locks = workControlLocks({
    loadingId: 7,
    operationalState: "PAUSADO",
    manifestStatus: "FINALIZADO",
    reversalCommand: "REVERSAO_DESATIVAR",
    userRole: "USUARIO",
  });
  assert.equal(locks.run, "");
  assert.equal(locks["reverse-on"], "");
});

test("início para frente exige reversão confirmada desligada e esteira parada", () => {
  const base = {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    loadingItems: [],
    operationalState: "PAUSADO",
    equipmentCode: "EST-001",
    userRole: "USUARIO",
    commandInFlight: false,
    pendingReadings: [],
  };
  const render = (extra) => work({ state: { ...base, ...extra } });
  assert.match(render({ reversalCommand: "REVERSAO_ATIVAR" }), /data-action="run"[^>]*disabled/);
  assert.match(render({ reversalCommand: null }), /data-action="run"[^>]*disabled/);
  assert.doesNotMatch(render({ reversalCommand: "REVERSAO_DESATIVAR" }), /data-action="run"[^>]*disabled/);
  assert.match(render({ operationalState: "CARREGANDO", reversalCommand: "REVERSAO_DESATIVAR" }), /data-action="run"[^>]*disabled/);
});

test("leitura de estado da Dala sincroniza a última reversão confirmada", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = { plcCommand: null, commandIntent: null };
  armazenamento.api = { fetch: async () => ({ ok: true }) };
  armazenamento.jsonResponse = async () => ({
    data: null,
    reversal_command: "REVERSAO_ATIVAR",
  });
  armazenamento.commandStatusRefresh = Promise.resolve();

  await armazenamento._loadPlcCommandStatus(7);

  assert.equal(armazenamento.state.reversalCommand, "REVERSAO_ATIVAR");
  assert.equal(armazenamento.state.returnMode, true);
});

test("resumo de sacas evita repetir a contagem de leituras válidas", () => {
  const markup = work({
    state: {
      selectedLoadingId: 7,
      loadingId: 7,
      activeLoadings: [{ id: 7, state: "PREPARANDO", equipment_id: 3 }],
      loadingItems: [{ name: "Produto", code: "SKU-1", loaded_quantity: 0, planned_quantity: 1 }],
      equipmentCode: "EST-001",
      romaneio: "7",
      truck: "ABC1234",
      operationalState: "PREPARANDO",
      detectedBags: 0,
      planned: 1,
      loaded: 0,
      userRole: "USUARIO",
      commandInFlight: false,
      emergency: false,
      pendingReadings: [],
    },
  });
  assert.match(markup, /Falta 1 leitura válida/);
  assert.match(markup, /<small>1 item<\/small>/);
  assert.doesNotMatch(markup, /<small>1 item · 0 leituras válidas<\/small>/);
  assert.doesNotMatch(markup, /Pendentes:|Válidas:/);
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

test("comando de reversão atualiza imediatamente a intenção visível", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    operationalState: "PAUSADO",
    running: false,
    returnMode: false,
    plcCommand: null,
    commandIntent: null,
  };
  armazenamento.api = { fetch: async () => ({ ok: true }) };
  armazenamento.jsonHeaders = () => ({});
  armazenamento.jsonResponse = async () => ({
    data: {
      command_request_id: 43,
      command: "REVERSAO_ATIVAR",
      status: "PENDENTE",
      message: "Comando registrado",
    },
  });

  await armazenamento.requestMachineReverse(7, "REVERSAO_ATIVAR");

  assert.equal(armazenamento.state.returnMode, true);
  assert.equal(armazenamento.state.reversalCommand, "REVERSAO_ATIVAR");
  assert.equal(armazenamento.state.commandIntent.command, "REVERSAO_ATIVAR");
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
