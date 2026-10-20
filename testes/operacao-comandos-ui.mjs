import assert from "node:assert/strict";
import test from "node:test";
import {
  paradaPodeSerEnfileiradaAposInicio,
  paradaPodeSubstituirInicio,
  podeLiberarEmergencia,
  podeVincularDala,
  alternarTecladoLeituraManual,
  workControlLocks,
  work,
} from "../interface/telas/operacao/operacao.js";
import { resolverComandoAtual } from "../interface/js/funcoes/estado-comando.js";
import { captureOperationScanner, restoreOperationScanner, focusOperationScanner, updateOperationScannerFocus, instalarRecuperacaoFocoLeitor, changeOperationLoading, operationStructureSignature } from "../interface/js/controladores/operacao.js";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

function criarArmazenamento() {
  const armazenamento = new ArmazenamentoTrace();
  const estadoInicial = armazenamento.state;
  const apiInicial = armazenamento.api;
  const servicosComEstado = Object.values(armazenamento)
    .filter((valor) => valor && valor.state === estadoInicial);
  const servicosComApi = Object.values(armazenamento)
    .filter((valor) => valor && valor.api === apiInicial);
  let estado = estadoInicial;
  Object.defineProperty(armazenamento, "state", {
    configurable: true,
    get: () => estado,
    set: (proximo) => {
      estado = proximo;
      servicosComEstado.forEach((servico) => { servico.state = proximo; });
    },
  });
  let api = apiInicial;
  Object.defineProperty(armazenamento, "api", {
    configurable: true,
    get: () => api,
    set: (proxima) => {
      api = proxima;
      servicosComApi.forEach((servico) => { servico.api = proxima; });
    },
  });
  return armazenamento;
}

test("comandos da máquina só ficam liberados com CLP online e capacidade recente confirmada", () => {
  const store = criarArmazenamento();
  store.state.equipmentId = 8;
  store.state.deviceStatusesUpdatedAt = new Date().toISOString();
  store.state.deviceStatuses = [{
    equipment_id: 8,
    device_type: "CLP",
    status: "ONLINE",
    machine_commands_available: false,
    machine_command_mode: "BLOQUEADO",
  }];

  assert.equal(store.comandosMaquinaDisponiveis(), false);
  assert.match(store.mensagemComandosMaquinaIndisponiveis(), /escrita física não foi habilitada/);

  store.state.deviceStatuses[0].machine_commands_available = true;
  assert.equal(store.comandosMaquinaDisponiveis(), true);

  store.state.deviceStatusesUpdatedAt = new Date(Date.now() - 7000).toISOString();
  assert.equal(store.comandosMaquinaDisponiveis(), false);
  assert.match(store.mensagemComandosMaquinaIndisponiveis(), /Sem confirmação recente/);
});

test("somente administrador da empresa e supervisor recebem a ação de vincular Dala", () => {
  assert.equal(podeVincularDala("ADMIN_EMPRESA"), true);
  assert.equal(podeVincularDala("SUPERVISOR"), true);
  assert.equal(podeVincularDala("USUARIO"), false);
  assert.equal(podeVincularDala("ADMIN_DALLOGIX"), false);
  assert.equal(podeVincularDala(null), false);
});

test("a tela esconde o vínculo de Dala para operador e informa quem pode agir", () => {
  const state = {
    selectedLoadingId: null,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: null }],
    equipments: [{ id: 3, name: "Dala 3", equipment_code: "D-003" }],
    userRole: "USUARIO",
  };
  const markup = work({ state });
  assert.doesNotMatch(markup, /class="reassign-loading-form"/);
  assert.match(markup, /Solicite a um administrador da empresa ou supervisor/);
});

test("a confirmação de código envia o formulário e deixa espaço para feedback", () => {
  const markup = work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    loadingItems: [],
    equipmentCode: "D-003",
    romaneio: "R-7",
    truck: "ABC1234",
    operationalState: "PAUSADO",
    detectedBags: 0,
    planned: 1,
    loaded: 0,
    userRole: "USUARIO",
    commandInFlight: false,
    emergency: false,
    pendingReadings: [{ id: 31 }],
  } });
  assert.match(markup, /data-action="identify-reading" type="submit"/);
  assert.match(markup, /inputmode="text"/);
  assert.match(markup, /class="form-feedback" data-form-feedback role="status"/);
});

test("pendências além da primeira página continuam visíveis e bloqueiam leitura paralela", () => {
  const markup = work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "CARREGANDO", equipment_id: 3 }],
    loadingItems: [],
    operationalState: "CARREGANDO",
    userRole: "USUARIO",
    pendingReadings: [{ id: 21 }],
    pendingReadingsTotal: 25,
    pendingReadingsPage: 2,
    pendingReadingsPages: 2,
  } });
  assert.match(markup, /25 pendentes · página 2 de 2/);
  assert.match(markup, /data-action="pending-readings-page" data-page="1"/);
  assert.match(markup, /data-action="pending-readings-page" data-page="3" disabled/);
  assert.match(markup, /Corrija a leitura pendente abaixo/);
});

test("envio offline pendente bloqueia nova leitura e avisa o operador", () => {
  const markup = work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "CARREGANDO", equipment_id: 3 }],
    loadingItems: [],
    operationalState: "CARREGANDO",
    userRole: "USUARIO",
    pendingReadings: [],
    offlineQueueSize: 1,
  } });
  assert.match(markup, /1 operação aguardando envio/);
  assert.match(markup, /Aguardando envio de operações locais….*disabled/);
});

test("indicador do scanner distingue foco, perda de foco e bloqueio", () => {
  const status = {
    textContent: "",
    classList: { toggle(name, value) { this[name] = value; } },
  };
  const input = { disabled: false };
  const root = {
    querySelector: (selector) => selector === "[data-scanner-focus]" ? status : input,
  };
  assert.equal(updateOperationScannerFocus(root, input), true);
  assert.match(status.textContent, /Leitor pronto/);
  assert.equal(status.classList["is-error"], false);
  assert.equal(updateOperationScannerFocus(root, {}), false);
  assert.match(status.textContent, /Leitor sem foco/);
  input.disabled = true;
  assert.equal(updateOperationScannerFocus(root, input), false);
  assert.match(status.textContent, /Leitor indisponível/);
});

test("leitor Elgin recupera o foco depois de toques fora de campos e respeita campos editáveis", () => {
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  let activeElement = { matches: () => false, closest: () => null };
  let pointerUp;
  let focusCalls = 0;
  const status = { textContent: "", classList: { toggle() {} } };
  const input = {
    disabled: false,
    matches: (selector) => selector.includes("manual-operation-reading-form"),
    focus() { focusCalls += 1; activeElement = this; },
  };
  const root = {
    dataset: {},
    isConnected: true,
    addEventListener: (eventName, callback) => { if (eventName === "pointerup") pointerUp = callback; },
    querySelector: (selector) => selector === "[data-scanner-focus]" ? status : input,
  };
  globalThis.document = { get activeElement() { return activeElement; } };
  globalThis.setTimeout = (callback) => { callback(); return 1; };
  try {
    assert.equal(instalarRecuperacaoFocoLeitor(root), true);
    assert.equal(instalarRecuperacaoFocoLeitor(root), false);
    pointerUp({ target: { closest: () => null } });
    assert.equal(focusCalls, 1);
    assert.match(status.textContent, /Leitor pronto/);
    pointerUp({ target: { closest: (selector) => selector.includes("manual-reading-keyboard-toggle") ? {} : null } });
    assert.equal(focusCalls, 1, "o botão do teclado virtual não deve devolver o foco ao leitor");
    activeElement = { matches: () => true, closest: () => null };
    pointerUp({ target: { closest: () => ({}) } });
    assert.equal(focusCalls, 1);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("a leitura principal oferece entrada pelo teclado touch sem perder o leitor", () => {
  const markup = work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "CARREGANDO", equipment_id: 3 }],
    loadingItems: [],
    equipmentCode: "D-003",
    romaneio: "R-7",
    truck: "ABC1234",
    operationalState: "CARREGANDO",
    detectedBags: 0,
    planned: 1,
    loaded: 0,
    userRole: "USUARIO",
    commandInFlight: false,
    emergency: false,
    pendingReadings: [],
  } });
  assert.match(markup, /inputmode="none"/);
  assert.match(markup, /class="button ghost small manual-reading-keyboard-toggle" type="button" aria-pressed="false">Digitar código/);
});

test("alternar teclado touch mantém o leitor de código como modo reversível", () => {
  const attributes = new Map([["inputmode", "none"]]);
  const input = {
    disabled: false,
    getAttribute: (name) => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, value),
    focus(options) { this.focusOptions = options; },
  };
  const button = {
    textContent: "Digitar código",
    setAttribute(name, value) { this[name] = value; },
  };

  assert.equal(alternarTecladoLeituraManual(input, button), true);
  assert.equal(attributes.get("inputmode"), "text");
  assert.equal(button.textContent, "Usar leitor");
  assert.equal(button["aria-pressed"], "true");
  assert.deepEqual(input.focusOptions, { preventScroll: true });

  assert.equal(alternarTecladoLeituraManual(input, button), false);
  assert.equal(attributes.get("inputmode"), "none");
  assert.equal(button.textContent, "Digitar código");
  assert.equal(button["aria-pressed"], "false");
});

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

test("liberação de emergência fica disponível somente para supervisão", () => {
  for (const role of ["ADMIN_EMPRESA", "SUPERVISOR"]) {
    assert.equal(podeLiberarEmergencia({ role, loadingId: 42 }), true);
  }
  assert.equal(podeLiberarEmergencia({ role: "USUARIO", loadingId: 42 }), false);
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
    assert.match(markup, /Leitura automática/);
    assert.doesNotMatch(markup, /Sensor|Câmera|Servidor/);
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

test("erro final antigo do gateway não permanece como cartão na tela de operação", () => {
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

  assert.doesNotMatch(markup, /Tempo limite Modbus; estado físico não confirmado\./);
  assert.doesNotMatch(markup, /work-command-history|Último comando/);
});

test("divergência mantém alerta, pausa do gateway e confirmação física explícita", () => {
  const markup = work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    loadingItems: [],
    equipmentCode: "EST-001",
    romaneio: "7",
    truck: "ABC1234",
    operationalState: "PAUSADO",
    stopReason: "PRODUTO_INCORRETO",
    operatorAlert: "Produto incorreto detectado. Remova a unidade.",
    detectedBags: 1,
    planned: 1,
    loaded: 0,
    userRole: "USUARIO",
    pendingReadings: [],
    plcCommand: { command: "PAUSAR_CARREGAMENTO", status: "ERRO", response_message: "Timeout Modbus" },
  } });

  assert.match(markup, /Produto incorreto detectado\. Remova a unidade\./);
  assert.match(markup, /O gateway não confirmou a parada: Timeout Modbus/);
  assert.match(markup, /name="confirmar_remocao" value="true" required/);
  assert.match(markup, /a esteira está fisicamente parada/);
  assert.match(markup, /data-action="run"[^>]*disabled/);
});

test("cancelamento antigo da parada não permanece como aviso na tela", () => {
  const markup = work({ state: {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    loadingItems: [],
    equipmentCode: "EST-001",
    operationalState: "PAUSADO",
    userRole: "USUARIO",
    reversalCommand: "REVERSAO_DESATIVAR",
    pendingReadings: [],
    plcCommand: {
      command: "PAUSAR_CARREGAMENTO",
      status: "REJEITADO",
      response_message: "Solicitação cancelada após confirmação física do operador, antes de ser reservada pelo gateway.",
    },
  } });
  assert.doesNotMatch(markup, /Parada cancelada antes do envio ao gateway/);
  assert.doesNotMatch(markup, /class="work-command-error" role="alert"/);
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

test("CLP indisponível bloqueia comandos normais e mantém a solicitação de emergência disponível", () => {
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

test("gateway sem liberação bloqueia comandos de rotina e mantém a emergência disponível", () => {
  const message = "O gateway ainda não confirmou a liberação dos comandos da máquina.";
  const state = {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    loadingItems: [],
    equipmentCode: "EST-001",
    operationalState: "PAUSADO",
    reversalCommand: "REVERSAO_DESATIVAR",
    userRole: "USUARIO",
    commandInFlight: false,
    pendingReadings: [],
  };
  const options = { machineCommandsAvailable: false, machineCommandsUnavailableMessage: message };
  const locks = workControlLocks(state, options);
  for (const action of ["run", "stop", "reverse-on", "reverse-off"]) {
    assert.equal(locks[action], message);
  }

  const markup = work({
    state,
    clpDisponivel: () => true,
    comandosMaquinaDisponiveis: () => false,
    mensagemComandosMaquinaIndisponiveis: () => message,
  });
  for (const action of ["run", "stop", "reverse-on", "reverse-off"]) {
    assert.match(markup, new RegExp(`data-action="${action}"[^>]*disabled`));
  }
  assert.match(markup, /data-action="emergency"(?![^>]*disabled)/);
  assert.doesNotMatch(markup, /work-control-lock-reasons|work-command-history/);
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
  assert.doesNotMatch(render({ reversalCommand: null }), /work-control-lock-reasons/);
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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

test("falha ao trocar Dala é exibida sem perder a seleção nem rejeitar o clique", async () => {
  const store = {
    state: { selectedLoadingId: 7, commandFeedback: "erro anterior" },
    loadActiveLoading: async (selectedId) => {
      assert.equal(selectedId, null);
      throw new Error("Falha de conexão");
    },
  };
  let renders = 0;

  const changed = await changeOperationLoading(store, () => { renders += 1; });

  assert.equal(changed, false);
  assert.equal(store.state.selectedLoadingId, 7);
  assert.equal(store.state.commandFeedback, "Falha de conexão");
  assert.equal(renders, 1);
});

test("troca de Dala atualiza a seleção e limpa erro anterior", async () => {
  const store = {
    state: { selectedLoadingId: 7, commandFeedback: "erro anterior" },
    loadActiveLoading: async (selectedId) => {
      assert.equal(selectedId, null);
      store.state.selectedLoadingId = null;
    },
  };
  let renders = 0;

  const changed = await changeOperationLoading(store, () => { renders += 1; });

  assert.equal(changed, true);
  assert.equal(store.state.selectedLoadingId, null);
  assert.equal(store.state.commandFeedback, "");
  assert.equal(renders, 1);
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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
  const armazenamento = criarArmazenamento();
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

test("snapshot ativo preserva a causa da pausa e o aviso do operador", async () => {
  const armazenamento = criarArmazenamento();
  armazenamento.state = { loadingId: 7, selectedLoadingId: 7, activeLoadings: [] };
  armazenamento.activeLoadingRefresh = Promise.resolve();
  const loading = {
    id: 7,
    state: "PAUSADO",
    equipment_id: 3,
    stop_reason: "EXCESSO",
    operator_alert: "Remova a unidade excedente e confirme para continuar.",
  };

  await armazenamento.applyActiveLoadingSnapshot([loading], 7);

  assert.equal(armazenamento.state.stopReason, "EXCESSO");
  assert.equal(armazenamento.state.operatorAlert, loading.operator_alert);
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

test("estado finalizando mantém a parada disponível como ação de segurança", () => {
  const locks = workControlLocks({
    loadingId: 7,
    operationalState: "FINALIZANDO",
    running: true,
    userRole: "USUARIO",
  });
  assert.equal(locks.stop, "");
  assert.match(locks.run, /finalizando/);
});

test("assinatura da Operação muda quando a parada pendente muda", () => {
  const base = { selectedLoadingId: 7, loadingId: 7, activeLoadings: [], pendingReadings: [], loadingItems: [] };
  const original = operationStructureSignature({ ...base, stopReason: null, operatorAlert: "" }, true);
  assert.notEqual(operationStructureSignature({ ...base, stopReason: "EXCESSO", operatorAlert: "Remova a unidade." }, true), original);
});

test("foco do leitor é restaurado sem roubar foco de outro campo de entrada", () => {
  let focusCalls = 0;
  const scanner = { disabled: false, focus: () => { focusCalls += 1; } };
  const correctionInput = { matches: (selector) => selector.includes("input"), focus: () => assert.fail("não deve roubar foco") };
  const button = { matches: () => false };
  const root = {
    querySelector: () => scanner,
    contains: (element) => [scanner, correctionInput, button].includes(element),
  };

  assert.equal(focusOperationScanner(root, correctionInput), false);
  const externalInput = { matches: (selector) => selector.includes("input"), focus: () => assert.fail("não deve roubar foco fora do formulário") };
  assert.equal(focusOperationScanner(root, externalInput), false);
  const dialogButton = { matches: () => false, closest: () => ({}) };
  assert.equal(focusOperationScanner(root, dialogButton), false);
  assert.equal(focusOperationScanner(root, button), true);
  assert.equal(focusCalls, 1);
});

test("resposta de status atrasada de outra Dala não sobrescreve a seleção atual", async () => {
  const armazenamento = criarArmazenamento();
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

test("assinatura da Operação muda quando reversão ou identificação da Dala muda", () => {
  const base = {
    selectedLoadingId: 7,
    loadingId: 7,
    activeLoadings: [{ id: 7, state: "PAUSADO", equipment_id: 3 }],
    operationalState: "PAUSADO",
    reversalCommand: "REVERSAO_ATIVAR",
    returnMode: true,
    equipmentCode: "DALA-03",
    truck: "ABC-1234",
    romaneio: "ROM-42",
    commandInFlight: false,
    pendingReadings: [],
    loadingItems: [],
  };
  const original = operationStructureSignature(base, true);
  assert.notEqual(
    operationStructureSignature({ ...base, reversalCommand: "REVERSAO_DESATIVAR", returnMode: false }, true),
    original,
  );
  assert.notEqual(operationStructureSignature({ ...base, truck: "XYZ-9876" }, true), original);
  assert.notEqual(operationStructureSignature(base, false), original);
});

test("status leve e recente do CLP é a fonte primária para liberar comandos", () => {
  const armazenamento = criarArmazenamento();
  armazenamento.state = {
    equipmentId: 3,
    monitoring: { dispositivos: [{ equipment_id: 3, device_type: "CLP", status: "OFFLINE" }] },
    monitoringUpdatedAt: new Date().toISOString(),
    deviceStatuses: [{ equipment_id: 3, device_type: "CLP", status: "ONLINE" }],
    deviceStatusesUpdatedAt: new Date().toISOString(),
  };
  assert.equal(armazenamento.clpDisponivel(), true);

  // Um snapshot completo recente não pode mascarar o status leve vencido.
  armazenamento.state.deviceStatusesUpdatedAt = new Date(Date.now() - 7000).toISOString();
  assert.equal(armazenamento.clpDisponivel(), false);
  assert.match(armazenamento.mensagemClpIndisponivel(), /servidor local/);

  armazenamento.state.deviceStatusesUpdatedAt = new Date().toISOString();
  armazenamento.state.deviceStatuses[0].status = "OK";
  assert.equal(armazenamento.clpDisponivel(), false);
});

test("snapshot completo continua como fallback até chegar o primeiro status leve", () => {
  const armazenamento = criarArmazenamento();
  armazenamento.state = {
    equipmentId: 3,
    monitoring: { dispositivos: [{ equipment_id: 3, device_type: "CLP", status: "ONLINE" }] },
    monitoringUpdatedAt: new Date().toISOString(),
    deviceStatuses: [],
    deviceStatusesUpdatedAt: null,
  };
  assert.equal(armazenamento.clpDisponivel(), true);
});

test("CLP sem last_seen não é exibido como sem sinal há zero segundos", () => {
  const armazenamento = criarArmazenamento();
  armazenamento.state = {
    equipmentId: 3,
    monitoringUpdatedAt: new Date().toISOString(),
    monitoring: { dispositivos: [{
      equipment_id: 3,
      device_type: "CLP",
      status: "OFFLINE",
      segundos_sem_sinal: null,
    }] },
  };
  assert.doesNotMatch(armazenamento.mensagemClpIndisponivel(), /0 segundos/);
});

test("heartbeat com zero segundo usa texto de menos de um segundo", () => {
  const armazenamento = criarArmazenamento();
  armazenamento.state = {
    equipmentId: 3,
    monitoringUpdatedAt: new Date().toISOString(),
    monitoring: { dispositivos: [{
      equipment_id: 3,
      device_type: "CLP",
      status: "OFFLINE",
      segundos_sem_sinal: 0,
    }] },
  };
  assert.match(armazenamento.mensagemClpIndisponivel(), /há menos de 1 segundo/);
});
