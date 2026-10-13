import assert from "node:assert/strict";
import test from "node:test";
import {
  paradaPodeSerEnfileiradaAposInicio,
  paradaPodeSubstituirInicio,
  podeLiberarEmergencia,
  workControlLocks,
  work,
} from "../interface/telas/operacao/operacao.js";
import { resolverComandoAtual } from "../interface/js/funcoes/estado-comando.js";
import { captureOperationScanner, restoreOperationScanner } from "../interface/js/controladores/operacao.js";
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
  assert.match(markup, /class="work-command-history" role="status"/);
  assert.match(markup, /Último comando \(Iniciar carregamento\)/);
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

test("CLP indisponível bloqueia comandos normais e mantém o pedido de emergência disponível", () => {
  const message = "CLP sem comunicação há 5 segundos. Novos comandos estão bloqueados.";
  const state = {
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
    pendingReadings: [],
  };
  const locks = workControlLocks(state, {
    clpAvailable: false,
    clpUnavailableMessage: message,
  });
  for (const action of ["run", "stop", "reverse-on", "reverse-off"]) {
    assert.equal(locks[action], message);
  }

  const markup = work({
    state,
    clpDisponivel: () => false,
    mensagemClpIndisponivel: () => message,
  });
  for (const action of ["run", "stop", "reverse-on", "reverse-off"]) {
    assert.match(markup, new RegExp(`data-action="${action}"[^>]*disabled`));
  }
  assert.match(markup, /data-action="emergency"(?![^>]*disabled)/);
  assert.match(markup, /class="work-command-error" role="status" aria-live="polite"/);
  assert.match(markup, /CLP sem comunicação há 5 segundos/);
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
  assert.match(render({ reversalCommand: null }), /class="work-control-lock-reasons" role="status"/);
  assert.match(render({ reversalCommand: null }), /Confirme a reversão desligada antes de ligar a esteira para frente/);
  assert.doesNotMatch(render({ reversalCommand: "REVERSAO_DESATIVAR" }), /data-action="run"[^>]*disabled/);
  assert.match(render({ operationalState: "CARREGANDO", reversalCommand: "REVERSAO_DESATIVAR" }), /data-action="run"[^>]*disabled/);
});

test("Dala sem histórico pode confirmar a reversão desligada antes de iniciar", () => {
  const base = {
    loadingId: 7,
    selectedLoadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    operationalState: "PAUSADO",
    reversalCommand: null,
    userRole: "USUARIO",
  };
  const unknownLocks = workControlLocks(base);
  assert.match(unknownLocks.run, /Confirme a reversão desligada/);
  assert.equal(unknownLocks["reverse-off"], "");

  const markup = work({ state: base });
  assert.match(markup, /data-action="reverse-off"(?![^>]*disabled)/);
  assert.match(markup, /data-action="run"[^>]*disabled/);

  const confirmedLocks = workControlLocks({ ...base, reversalCommand: "REVERSAO_DESATIVAR" });
  assert.equal(confirmedLocks.run, "");
  assert.match(confirmedLocks["reverse-off"], /já está desligada/);
});

test("status e comando visíveis sempre pertencem à solicitação mais recente", () => {
  const localNewer = {
    id: 42,
    command: "INICIAR_CARREGAMENTO",
    status: "PENDENTE",
  };
  const pollOlder = {
    id: 41,
    command: "REVERSAO_DESATIVAR",
    status: "APLICADO",
  };
  assert.equal(resolverComandoAtual(pollOlder, localNewer), localNewer);
  const locks = workControlLocks({
    loadingId: 7,
    operationalState: "PAUSADO",
    reversalCommand: "REVERSAO_DESATIVAR",
    userRole: "USUARIO",
    plcCommand: pollOlder,
    commandIntent: localNewer,
  });
  assert.match(locks.run, /Aguarde o envio/);
  assert.equal(locks.stop, "");

  const pollNewer = { id: 43, command: "PAUSAR_CARREGAMENTO", status: "PROCESSANDO" };
  const intentOlder = { id: 42, command: "INICIAR_CARREGAMENTO", status: "PENDENTE" };
  assert.equal(resolverComandoAtual(pollNewer, intentOlder), pollNewer);
  const newerLocks = workControlLocks({
    loadingId: 7,
    operationalState: "PAUSADO",
    userRole: "USUARIO",
    plcCommand: pollNewer,
    commandIntent: intentOlder,
  });
  assert.match(newerLocks.run, /Aguarde o gateway/);
  assert.match(newerLocks.stop, /Aguarde o gateway/);
});

test("comando aplicado não substitui o estado operacional retornado pelo carregamento", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    operationalState: "PAUSADO",
    running: false,
    plcCommand: { id: 42, command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
    commandIntent: {
      id: 42,
      loadingId: 7,
      command: "INICIAR_CARREGAMENTO",
      status: "PENDENTE",
      previousState: "PAUSADO",
    },
  };
  armazenamento.api = { fetch: async () => ({ ok: true }) };
  armazenamento.jsonResponse = async () => ({
    data: { id: 42, command: "INICIAR_CARREGAMENTO", status: "APLICADO" },
    reversal_command: null,
  });

  await armazenamento._loadPlcCommandStatus(7);

  assert.equal(armazenamento.state.operationalState, "PAUSADO");
  assert.equal(armazenamento.state.running, false);
  assert.equal(armazenamento.state.commandIntent, null);
});

test("consulta sem comando limpa intenção sem identificador local", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    operationalState: "PAUSADO",
    plcCommand: null,
    commandIntent: { id: null, loadingId: 7, command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
  };
  armazenamento.api = { fetch: async () => ({ ok: true }) };
  armazenamento.jsonResponse = async () => ({ data: null });

  await armazenamento._loadPlcCommandStatus(7);

  assert.equal(armazenamento.state.commandIntent, null);
  assert.equal(armazenamento.state.operationalState, "PAUSADO");
});

test("nova seleção e ausência de carregamento removem a intenção anterior", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    selectedLoadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    plcCommand: { id: 42, command: "INICIAR_CARREGAMENTO", status: "APLICADO" },
    commandIntent: { id: 42, loadingId: 7, command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
  };

  await armazenamento._applyActiveLoadingSnapshot([], 7);

  assert.equal(armazenamento.state.commandIntent, null);
  assert.equal(armazenamento.state.plcCommand, null);
});

test("trocar de Dala descarta comando e intenção da seleção anterior", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    selectedLoadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    plcCommand: { id: 42, command: "INICIAR_CARREGAMENTO", status: "APLICADO" },
    commandIntent: { id: 42, loadingId: 7, command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
  };
  const nextLoading = {
    id: 8,
    state: "PREPARANDO",
    equipment_id: 4,
    valid_readings: 0,
    detected_bags: 0,
    planned_quantity: 1,
  };

  const selected = await armazenamento._applyActiveLoadingSnapshot([nextLoading], 8);

  assert.equal(selected, nextLoading);
  assert.equal(armazenamento.state.loadingId, 8);
  assert.equal(armazenamento.state.commandIntent, null);
  assert.equal(armazenamento.state.plcCommand, null);
});

test("comando mais novo substitui intenção local antiga", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    operationalState: "PAUSADO",
    running: false,
    plcCommand: { id: 42, command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
    commandIntent: { id: 42, loadingId: 7, command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
  };
  armazenamento.api = { fetch: async () => ({ ok: true }) };
  armazenamento.jsonResponse = async () => ({
    data: { id: 43, command: "PAUSAR_CARREGAMENTO", status: "APLICADO" },
    reversal_command: null,
  });

  await armazenamento._loadPlcCommandStatus(7);

  assert.equal(armazenamento.state.plcCommand.id, 43);
  assert.equal(armazenamento.state.commandIntent, null);
  assert.equal(armazenamento.state.operationalState, "PAUSADO");
});

test("leitor mantém foco, texto parcial e cursor durante uma atualização da tela", () => {
  const oldInput = {
    value: "7890123",
    selectionStart: 4,
    selectionEnd: 4,
    selectionDirection: "none",
    matches: (selector) => selector.includes("manual-operation-reading-form"),
  };
  const newInput = {
    value: "",
    disabled: false,
    focus(options) { this.focusOptions = options; },
    setSelectionRange(start, end, direction) { this.selection = [start, end, direction]; },
  };
  const root = {
    contains: (node) => node === oldInput,
    querySelector: () => newInput,
  };

  const snapshot = captureOperationScanner(root, oldInput);
  assert.equal(restoreOperationScanner(root, snapshot), true);
  assert.equal(newInput.value, "7890123");
  assert.deepEqual(newInput.selection, [4, 4, "none"]);
  assert.deepEqual(newInput.focusOptions, { preventScroll: true });
});

test("resumo separa eventos detectados das leituras válidas", () => {
  const markup = work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "CARREGANDO", equipment_id: 3 }],
    loadingItems: [],
    operationalState: "CARREGANDO",
    detectedBags: 10,
    loaded: 7,
    planned: 12,
    userRole: "USUARIO",
    pendingReadings: [],
  } });
  assert.match(markup, /10<\/b> detectadas · <b data-live="loaded">7<\/b> válidas \/ <b data-live="planned">12<\/b> previstas/);
  assert.match(markup, /aria-valuenow="58"/);
  assert.match(markup, /Faltam 5 leituras válidas/);
});

test("quantidade prevista zero não aparece concluída e excesso é sinalizado", () => {
  const renderItem = (planned, loaded, remaining) => work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    loadingItems: [{ name: "Produto", loaded_quantity: loaded, planned_quantity: planned, remaining_quantity: remaining }],
    operationalState: "PAUSADO",
    detectedBags: loaded,
    loaded,
    planned,
    reversalCommand: "REVERSAO_DESATIVAR",
    userRole: "USUARIO",
    pendingReadings: [],
  } });
  const noPlan = renderItem(0, 0, 0);
  assert.match(noPlan, /Sem previsão/);
  assert.doesNotMatch(noPlan, /Concluído/);
  assert.match(noPlan, /Quantidade prevista não informada/);

  const over = renderItem(5, 6, 0);
  assert.match(over, /Excedente/);
  assert.match(over, /Acima do previsto <strong>1<\/strong>/);

  const explicitZero = renderItem(5, 2, 0);
  assert.match(explicitZero, /Faltam validar <strong>0<\/strong>/);
});

test("mais de uma Dala mostra troca e o fallback usa a Dala selecionada", () => {
  const markup = work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [
      { id: 7, state: "PAUSADO", equipment_id: 2 },
      { id: 8, state: "PREPARANDO", equipment_id: 3 },
    ],
    equipments: [
      { id: 1, equipment_code: "DALA-ERRADA" },
      { id: 3, equipment_code: "DALA-SELECIONADA" },
    ],
    equipmentId: 3,
    equipmentCode: "—",
    loadingItems: [],
    operationalState: "PAUSADO",
    userRole: "USUARIO",
    reversalCommand: "REVERSAO_DESATIVAR",
    pendingReadings: [],
  } });
  assert.match(markup, /data-action="change-loading"/);
  assert.match(markup, /Dala DALA-SELECIONADA/);
  assert.doesNotMatch(markup, /DALA-ERRADA/);
});

test("falha ao selecionar Dala pode ser exibida sem notificação flutuante", () => {
  const markup = work({ state: {
    selectedLoadingId: null,
    loadingId: null,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    commandFeedback: "Falha <script>select</script>",
  } });
  assert.match(markup, /class="work-selection-error" role="alert"/);
  assert.match(markup, /Falha &lt;script&gt;select&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>select<\/script>/);
});

test("leitura de estado da Dala sincroniza a última reversão confirmada", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = { loadingId: 7, plcCommand: null, commandIntent: null };
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
  armazenamento.state.loadingId = 7;
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

test("excesso total de leituras válidas gera alerta de conferência", () => {
  const markup = work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "FINALIZADO", equipment_id: 3 }],
    loadingItems: [],
    operationalState: "FINALIZADO",
    detectedBags: 8,
    loaded: 8,
    planned: 5,
    userRole: "USUARIO",
    reversalCommand: "REVERSAO_DESATIVAR",
    pendingReadings: [],
  } });
  assert.match(markup, /class="work-completion-notice excess"/);
  assert.match(markup, /3 leituras válidas acima do previsto/);
});

test("comandos normais respeitam os perfis aceitos pelo endpoint", () => {
  const locks = workControlLocks({
    loadingId: 7,
    operationalState: "PAUSADO",
    reversalCommand: "REVERSAO_DESATIVAR",
    userRole: "VISUALIZADOR",
  });
  for (const action of ["run", "stop", "reverse-on", "reverse-off"]) {
    assert.match(locks[action], /Seu perfil não pode enviar comandos/);
  }
});

test("estado finalizando explica o bloqueio de parada", () => {
  const locks = workControlLocks({
    loadingId: 7,
    operationalState: "FINALIZANDO",
    running: true,
    userRole: "USUARIO",
  });
  assert.match(locks.stop, /finalizando/);
});

test("resposta de status atrasada de outra Dala não sobrescreve a seleção atual", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 8,
    operationalState: "CARREGANDO",
    plcCommand: { id: 55, command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
    commandIntent: { id: 55, loadingId: 8, command: "INICIAR_CARREGAMENTO", status: "PENDENTE" },
  };
  armazenamento.api = { fetch: async () => ({ ok: true }) };
  armazenamento.jsonResponse = async () => ({
    data: { id: 42, command: "PAUSAR_CARREGAMENTO", status: "APLICADO" },
    reversal_command: "REVERSAO_ATIVAR",
  });

  await armazenamento._loadPlcCommandStatus(7);

  assert.equal(armazenamento.state.loadingId, 8);
  assert.equal(armazenamento.state.operationalState, "CARREGANDO");
  assert.equal(armazenamento.state.plcCommand.id, 55);
  assert.equal(armazenamento.state.reversalCommand, undefined);
});
