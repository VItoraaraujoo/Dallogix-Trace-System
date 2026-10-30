import assert from "node:assert/strict";
import test from "node:test";
import { bindOperationalForms } from "../interface/js/controladores/formularios-operacionais.js";

function criarFormulario({ dataset = {}, fields = {}, buttons = [] } = {}) {
  const listeners = new Map();
  const form = {
    dataset: { ...dataset },
    isConnected: true,
    addEventListener(type, handler) { listeners.set(type, handler); },
    querySelector(selector) {
      if (selector === 'button[type="submit"]') return buttons[0] || null;
      return fields[selector] || null;
    },
    querySelectorAll(selector) {
      return selector === "button" ? buttons : [];
    },
    requestSubmit() { this.lastSubmission = this.submit(); return this.lastSubmission; },
    submit() { return listeners.get("submit")({ preventDefault() {} }); },
  };
  return form;
}

function criarRoot({ one = {}, many = {} } = {}) {
  return {
    querySelector(selector) { return one[selector] || null; },
    querySelectorAll(selector) { return many[selector] || []; },
  };
}

function criarHarness({ root, store = {}, values = {} } = {}) {
  const calls = [];
  const feedback = [];
  const notifications = [];
  const navigation = [];
  const warnings = [];
  let renders = 0;
  bindOperationalForms({
    root,
    store: {
      async prepareLoading(data) { calls.push(["prepareLoading", data]); },
      async reassignLoading(...args) { calls.push(["reassignLoading", ...args]); },
      async registerManualReading(...args) { calls.push(["registerManualReading", ...args]); return { result: "VALIDO", load_status: "COMPLETO" }; },
      async identifyReading(...args) { calls.push(["identifyReading", ...args]); },
      async confirmStopRemoval() { calls.push(["confirmStopRemoval"]); },
      ...store,
    },
    navigate: async (...args) => navigation.push(args),
    loadingId: () => "rom-12",
    dashboardQuery: () => "?from=dashboard",
    render: () => { renders += 1; },
    notify: (message) => notifications.push(message),
    setFeedback: (...args) => feedback.push(args),
    updateScannerFocus: (...args) => calls.push(["updateScannerFocus", ...args]),
    logWarning: (...args) => warnings.push(args),
    schedule: (callback) => callback(),
    readForm: (form) => values.get(form) || {},
  });
  return { calls, feedback, notifications, navigation, warnings, get renders() { return renders; } };
}

test("preparar carregamento preserva os dados e navega após salvar", async () => {
  const button = { disabled: false };
  const form = criarFormulario({ fields: { 'button[type="submit"]': button } });
  const harness = criarHarness({
    root: criarRoot({ one: { "#prepare-loading-form": form } }),
    values: new Map([[form, { truck_id: "caminhao-3", equipment_id: "dala-8" }]]),
  });

  await form.submit();

  assert.deepEqual(harness.calls, [["prepareLoading", {
    romaneio_id: "rom-12",
    truck_id: "caminhao-3",
    equipment_id: "dala-8",
  }]]);
  assert.deepEqual(harness.navigation, [["work", "?from=dashboard"]]);
  assert.equal(button.disabled, false);
});

test("reassociar Dala apresenta feedback de progresso e atualiza a tela", async () => {
  const button = { disabled: false };
  const form = criarFormulario({ dataset: { loadingId: "load-5" }, fields: { 'button[type="submit"]': button } });
  const harness = criarHarness({
    root: criarRoot({ many: { ".reassign-loading-form": [form] } }),
    values: new Map([[form, { equipment_id: "dala-9" }]]),
  });

  await form.submit();

  assert.deepEqual(harness.calls, [["reassignLoading", "load-5", "dala-9"]]);
  assert.deepEqual(harness.feedback, [[form, "Vinculando a nova Dala…"]]);
  assert.equal(harness.renders, 1);
  assert.equal(button.disabled, false);
});

test("leitura confirmada limpa o campo e devolve o foco ao scanner", async () => {
  const inputListeners = new Map();
  const input = {
    value: "COD-123",
    disabled: false,
    addEventListener(type, handler) { inputListeners.set(type, handler); },
    focus() { this.focused = true; },
  };
  const form = criarFormulario({ fields: { '[name="barcode"]': input } });
  const harness = criarHarness({
    root: criarRoot({
      one: { ".manual-operation-reading-form": form, "#screen-root": {} },
      many: { ".manual-operation-reading-form": [form] },
    }),
    values: new Map([[form, { barcode: "COD-123" }]]),
  });

  let defaultPrevented = false;
  inputListeners.get("keydown")({ key: "Enter", preventDefault() { defaultPrevented = true; } });
  assert.equal(defaultPrevented, true);
  await form.lastSubmission;

  assert.deepEqual(harness.calls[0], ["registerManualReading", "COD-123"]);
  assert.deepEqual(harness.feedback, [
    [form, "Registrando leitura…"],
    [form, "Código registrado e quantidade programada atingida.", ""],
  ]);
  assert.equal(input.value, "");
  assert.equal(input.focused, true);
  assert.equal(harness.renders, 1);
  assert.equal(form.dataset.submitting, "");
  assert.equal(input.disabled, false);
});

test("identificação pendente mostra ao operador o resultado real da classificação", async () => {
  const inputListeners = new Map();
  const input = {
    value: "COD-ERRADO",
    disabled: false,
    addEventListener(type, handler) { inputListeners.set(type, handler); },
  };
  const submitButton = { disabled: false };
  const correctionForm = criarFormulario({
    dataset: { readingId: "91" },
    fields: { '[name="barcode"]': input },
    buttons: [submitButton],
  });
  const operationForm = criarFormulario();
  const result = {
    result: "PRODUTO_INCORRETO",
    operator_alert: "Produto incorreto identificado. Confira a unidade.",
  };
  let identification;
  const harness = criarHarness({
    root: criarRoot({
      one: { ".manual-operation-reading-form": operationForm, "#screen-root": {} },
      many: { ".manual-reading-form": [correctionForm] },
    }),
    store: { async identifyReading(...args) { identification = args; return result; } },
    values: new Map([[correctionForm, { barcode: "COD-ERRADO" }]]),
  });

  await correctionForm.submit();

  assert.deepEqual(identification, ["91", "COD-ERRADO"]);
  assert.equal(harness.renders, 1);
  assert.deepEqual(harness.feedback.at(-1), [
    operationForm,
    "Produto incorreto identificado. Confira a unidade.",
    "error",
  ]);
  assert.equal(submitButton.disabled, false);
});

test("falha de rede mantém o código no campo para nova tentativa", async () => {
  const input = { value: "COD-456", disabled: false, addEventListener() {}, focus() {} };
  const form = criarFormulario({ fields: { '[name="barcode"]': input }, buttons: [{ disabled: false }] });
  const harness = criarHarness({
    root: criarRoot({ one: { ".manual-operation-reading-form": form, "#screen-root": {} }, many: { ".manual-operation-reading-form": [form] } }),
    store: { async registerManualReading() { throw new Error("servidor indisponível"); } },
    values: new Map([[form, { barcode: "COD-456" }]]),
  });

  await form.submit();

  assert.match(harness.feedback.at(-1)[1], /servidor indisponível/);
  assert.equal(harness.feedback.at(-1)[2], "error");
  assert.equal(input.value, "COD-456");
  assert.equal(harness.renders, 0);
  assert.equal(harness.warnings.length, 0);
});

test("remoção de parada exige confirmação antes de gravar", async () => {
  const confirmation = { checked: false };
  const button = { disabled: false };
  const form = criarFormulario({ fields: { '[name="confirmar_remocao"]': confirmation }, buttons: [button] });
  const harness = criarHarness({ root: criarRoot({ many: { ".confirm-stop-removal-form": [form] } }) });

  await form.submit();
  assert.equal(harness.calls.length, 0);
  assert.match(harness.feedback[0][1], /Confirme a remoção/);

  confirmation.checked = true;
  await form.submit();
  assert.deepEqual(harness.calls, [["confirmStopRemoval"]]);
  assert.match(harness.notifications[0], /operação continua pausada/);
  assert.equal(harness.renders, 1);
  assert.equal(button.disabled, false);
});
