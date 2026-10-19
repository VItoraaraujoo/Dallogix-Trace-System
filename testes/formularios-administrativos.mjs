import assert from "node:assert/strict";
import test from "node:test";
import { bindAdministrativeForms } from "../interface/js/controladores/formularios-administrativos.js";

function criarFormulario(dataset = {}) {
  let submitHandler;
  const button = { disabled: false };
  const form = {
    dataset: { ...dataset },
    addEventListener(type, handler) {
      assert.equal(type, "submit");
      submitHandler = handler;
    },
    querySelector(selector) {
      assert.equal(selector, 'button[type="submit"]');
      return button;
    },
    reset() {
      this.wasReset = true;
    },
  };
  return {
    form,
    button,
    submit() {
      return submitHandler({ preventDefault() {} });
    },
  };
}

function criarRoot(forms = {}, selector = null) {
  return {
    querySelector(query) {
      return forms[query]?.form || (query === "#users-company-selector" ? selector : null);
    },
  };
}

function criarHarness({ forms, selector, store, values = {} }) {
  const feedback = [];
  const notifications = [];
  const calls = [];
  let renders = 0;
  const effectiveStore = store || {
    state: {},
    async createUser(data) { calls.push(["createUser", data]); },
    async loadUsers() { calls.push(["loadUsers"]); },
    async createCompany(data) { calls.push(["createCompany", data]); },
    async loadCompanies() { calls.push(["loadCompanies"]); },
    async renameCompany(...args) { calls.push(["renameCompany", ...args]); },
    async loadCompanyDetail() { calls.push(["loadCompanyDetail"]); },
    async createIndustrialInstallation(name) { calls.push(["createIndustrialInstallation", name]); },
  };

  bindAdministrativeForms({
    root: criarRoot(forms, selector),
    store: effectiveStore,
    render: () => { renders += 1; },
    notify: (message) => notifications.push(message),
    setFeedback: (...args) => feedback.push(args),
    readForm: (form) => values[Object.keys(forms).find((key) => forms[key].form === form)] || {},
  });

  return { calls, effectiveStore, feedback, notifications, get renders() { return renders; } };
}

test("cadastro de usuário persiste, atualiza a lista e limpa o formulário", async () => {
  const user = criarFormulario();
  const harness = criarHarness({
    forms: { "#user-create-form": user },
    values: { "#user-create-form": { name: "Operador", email: "op@example.test" } },
  });

  await user.submit();

  assert.deepEqual(harness.calls, [
    ["createUser", { name: "Operador", email: "op@example.test" }],
    ["loadUsers"],
  ]);
  assert.equal(user.form.wasReset, true);
  assert.equal(harness.renders, 1);
  assert.deepEqual(harness.notifications, ["Login criado."]);
  assert.equal(user.form.dataset.submitting, "0");
  assert.equal(user.button.disabled, false);
});

test("criação de empresa e PC mantém ordem de recarga e avisos", async () => {
  const company = criarFormulario();
  const pc = criarFormulario();
  const harness = criarHarness({
    forms: { "#company-create-form": company, "#industrial-pc-create-form": pc },
    values: {
      "#company-create-form": { name: "Fábrica" },
      "#industrial-pc-create-form": { name: "PC da Dala 1" },
    },
  });

  await company.submit();
  await pc.submit();

  assert.deepEqual(harness.calls, [
    ["createCompany", { name: "Fábrica" }],
    ["loadCompanies"],
    ["createIndustrialInstallation", "PC da Dala 1"],
    ["loadCompanyDetail"],
  ]);
  assert.deepEqual(harness.notifications, [
    "Empresa criada. Agora crie o login de administrador.",
    "PC industrial cadastrado. Agora gere o código individual para ativá-lo.",
  ]);
  assert.equal(company.form.wasReset, true);
  assert.equal(pc.form.wasReset, undefined);
});

test("renomeação usa o identificador do formulário e recarrega o detalhe", async () => {
  const rename = criarFormulario({ companyId: "42" });
  const harness = criarHarness({
    forms: { "#company-rename-form": rename },
    values: { "#company-rename-form": { name: "Unidade Norte" } },
  });

  await rename.submit();

  assert.deepEqual(harness.calls, [
    ["renameCompany", "42", "Unidade Norte"],
    ["loadCompanyDetail"],
  ]);
  assert.deepEqual(harness.notifications, ["Empresa renomeada."]);
});

test("falha apresenta feedback e sempre libera o envio", async () => {
  const user = criarFormulario();
  const harness = criarHarness({
    forms: { "#user-create-form": user },
    store: {
      state: {},
      async createUser() { throw new Error("E-mail já cadastrado"); },
      async loadUsers() { assert.fail("não recarrega após falha"); },
    },
  });

  await user.submit();

  assert.deepEqual(harness.feedback, [
    [user.form, ""],
    [user.form, "E-mail já cadastrado", "error"],
  ]);
  assert.deepEqual(harness.notifications, ["E-mail já cadastrado"]);
  assert.equal(harness.renders, 0);
  assert.equal(user.form.dataset.submitting, "0");
  assert.equal(user.button.disabled, false);
});

test("envio administrativo em andamento não dispara uma segunda gravação", async () => {
  const user = criarFormulario();
  let releaseSave;
  let enteredSave;
  const saveStarted = new Promise((resolve) => { enteredSave = resolve; });
  const pendingSave = new Promise((resolve) => { releaseSave = resolve; });
  let creates = 0;
  const harness = criarHarness({
    forms: { "#user-create-form": user },
    store: {
      state: {},
      async createUser() {
        creates += 1;
        enteredSave();
        await pendingSave;
      },
      async loadUsers() {},
    },
  });

  const firstSubmit = user.submit();
  await saveStarted;
  await user.submit();
  assert.equal(creates, 1);
  assert.equal(user.button.disabled, true);

  releaseSave();
  await firstSubmit;
  assert.equal(user.button.disabled, false);
  assert.equal(harness.renders, 1);
});

test("seletor de empresa atualiza escopo de usuários", async () => {
  const selector = {
    value: "7",
    addEventListener(type, handler) {
      assert.equal(type, "change");
      this.change = handler;
    },
  };
  const harness = criarHarness({ selector });

  await selector.change();

  assert.equal(harness.effectiveStore.state.selectedCompanyId, "7");
  assert.deepEqual(harness.calls, [["loadUsers"]]);
  assert.equal(harness.renders, 1);
});
