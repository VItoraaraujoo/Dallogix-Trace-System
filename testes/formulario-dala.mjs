import assert from "node:assert/strict";
import test from "node:test";
import {
  bindDalaCreationForm,
  bindDalaEditForm,
} from "../interface/js/controladores/formulario-dala.js?v=202610190001";

function criarFormulario(id = "") {
  let submitHandler;
  const feedback = { textContent: "", hidden: true, className: "" };
  const buttons = [{ disabled: false }, { disabled: false }];
  const form = {
    dataset: { id },
    addEventListener(eventName, handler) {
      assert.equal(eventName, "submit");
      submitHandler = handler;
    },
    querySelector(selector) {
      assert.equal(selector, "[data-form-feedback]");
      return feedback;
    },
    querySelectorAll(selector) {
      assert.equal(selector, "button");
      return buttons;
    },
  };
  return {
    form,
    feedback,
    buttons,
    submit() {
      return submitHandler({ preventDefault() {} });
    },
  };
}

const validEquipment = {
  name: "Esteira principal",
  equipment_code: "esteira_principal",
  plc_ip: "192.168.1.10",
  plc_port: "502",
};

test("cadastro valida, salva, atualiza a tela e consulta conexão da Dala", async () => {
  const harness = criarFormulario();
  const notifications = [];
  const operations = [];
  const store = {
    state: { dalaFormOpen: true },
    async createEquipment(data) { operations.push(["create", data]); return { id: 12 }; },
    async checkEquipmentStatus(id) { operations.push(["status", id]); return { message: "CLP online" }; },
  };
  let renders = 0;
  bindDalaCreationForm({
    form: harness.form,
    store,
    render: () => { renders += 1; },
    notify: (message) => notifications.push(message),
    readForm: () => validEquipment,
  });

  await harness.submit();

  assert.deepEqual(operations, [["create", validEquipment], ["status", 12]]);
  assert.deepEqual(notifications, ["Dala cadastrada. CLP online"]);
  assert.equal(store.state.dalaFormOpen, false);
  assert.equal(renders, 1);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => !button.disabled));
});

test("cadastro inválido não grava Dala e explica a validação", async () => {
  const harness = criarFormulario();
  const notifications = [];
  let apiCalls = 0;
  bindDalaCreationForm({
    form: harness.form,
    store: { state: {}, async createEquipment() { apiCalls += 1; } },
    render() {},
    notify: (message) => notifications.push(message),
    readForm: () => ({ ...validEquipment, equipment_code: "Esteira 1" }),
  });

  await harness.submit();

  assert.equal(apiCalls, 0);
  assert.match(harness.feedback.textContent, /identificador/);
  assert.equal(harness.feedback.className, "form-feedback is-error");
  assert.deepEqual(notifications, [harness.feedback.textContent]);
});

test("falha no cadastro libera botões e não consulta conectividade", async () => {
  const harness = criarFormulario();
  const notifications = [];
  const store = {
    state: { dalaFormOpen: true },
    async createEquipment() { throw new Error("Banco indisponível"); },
    async checkEquipmentStatus() { assert.fail("não deve consultar uma Dala não cadastrada"); },
  };
  bindDalaCreationForm({
    form: harness.form,
    store,
    render: () => assert.fail("não deve renderizar após falha"),
    notify: (message) => notifications.push(message),
    readForm: () => validEquipment,
  });

  await harness.submit();

  assert.deepEqual(notifications, ["Banco indisponível"]);
  assert.equal(store.state.dalaFormOpen, true);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => !button.disabled));
});

test("verificação da conexão após o cadastro apresenta erro sem desfazer a Dala", async () => {
  const harness = criarFormulario();
  const notifications = [];
  let renders = 0;
  bindDalaCreationForm({
    form: harness.form,
    store: {
      state: {},
      async createEquipment() { return { id: 12 }; },
      async checkEquipmentStatus() { throw new Error("Timeout Modbus"); },
    },
    render: () => { renders += 1; },
    notify: (message) => notifications.push(message),
    readForm: () => validEquipment,
  });

  await harness.submit();

  assert.equal(renders, 1);
  assert.deepEqual(notifications, ["Dala cadastrada, mas a verificação de conexão falhou: Timeout Modbus"]);
});

test("edição mantém bloqueio durante a navegação e impede envio duplicado", async () => {
  const harness = criarFormulario("12");
  const notifications = [];
  const updates = [];
  const destinations = [];
  let resolveNavigation;
  let startNavigation;
  const navigationStarted = new Promise((resolve) => { startNavigation = resolve; });
  const navigation = new Promise((resolve) => { resolveNavigation = resolve; });
  const store = {
    async updateEquipment(data) { updates.push(data); },
    async checkEquipmentStatus(id) { return { message: `CLP ${id} online` }; },
  };
  bindDalaEditForm({
    form: harness.form,
    store,
    navigate: (...args) => { destinations.push(args); startNavigation(); return navigation; },
    returnPage: () => "dalas",
    notify: (message) => notifications.push(message),
    readForm: () => validEquipment,
  });

  const firstSubmission = harness.submit();
  await navigationStarted;
  assert.equal(harness.form.dataset.submitting, "1");
  assert.ok(harness.buttons.every((button) => button.disabled));
  await harness.submit();
  assert.equal(updates.length, 1);

  resolveNavigation();
  await firstSubmission;

  assert.deepEqual(updates, [{ id: "12", ...validEquipment }]);
  assert.deepEqual(destinations, [["dala", "?id=12&from=dalas"]]);
  assert.deepEqual(notifications, ["Dala atualizada. CLP 12 online"]);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => !button.disabled));
});

test("falha ao editar informa erro, não navega e libera os botões", async () => {
  const harness = criarFormulario("12");
  const notifications = [];
  bindDalaEditForm({
    form: harness.form,
    store: { async updateEquipment() { throw new Error("Falha ao atualizar Dala"); } },
    navigate: () => assert.fail("não deve navegar após falha no salvamento"),
    returnPage: () => "dalas",
    notify: (message) => notifications.push(message),
    readForm: () => validEquipment,
  });

  await harness.submit();

  assert.deepEqual(notifications, ["Falha ao atualizar Dala"]);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => !button.disabled));
});
