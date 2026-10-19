import assert from "node:assert/strict";
import test from "node:test";
import {
  bindLoginForm,
  bindLocalActivationForm,
  renderLogin,
  renderLocalActivation,
} from "../interface/telas/acesso/acesso.js?v=202610190036";

function criarFormulario() {
  let submitHandler;
  const button = { disabled: false, textContent: "Entrar" };
  const form = {
    dataset: {},
    addEventListener(eventName, handler) {
      assert.equal(eventName, "submit");
      submitHandler = handler;
    },
    querySelector(selector) {
      assert.equal(selector, 'button[type="submit"]');
      return button;
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

function dependencias(harness, overrides = {}) {
  const state = { authenticatedUser: null, storedUser: null, csrfToken: null, warnings: [], messages: [] };
  const config = {
    form: harness.form,
    api: { async fetch() { return { ok: true, async json() { return {}; } }; } },
    render: (message) => state.messages.push(message),
    onAuthenticated: (user, token) => {
      state.authenticatedUser = user;
      state.storedUser = user;
      state.csrfToken = token;
    },
    persistLog: (record) => { state.persistedLog = record; },
    configureLogTransport: (persist) => { state.persistLog = persist; },
    redirectAfterLogin: () => "/dashboard.html",
    logWarning: (...args) => state.warnings.push(args),
    windowRef: { location: { replace: (url) => { state.redirect = url; } } },
    readForm: () => ({ login: "operador", password: "senha" }),
    ...overrides,
  };
  return { config, state };
}

test("login salva sessão, inicia logs e redireciona após autenticação", async () => {
  const harness = criarFormulario();
  const { config, state } = dependencias(harness);
  const user = { id: 5, role: "OPERADOR" };
  let request;
  config.api.fetch = async (path, options) => {
    request = { path, options };
    return { ok: true, async json() { return { authenticated: true, user, csrf_token: "csrf-1" }; } };
  };

  assert.equal(bindLoginForm(config), true);
  await harness.submit();

  assert.equal(request.path, "/api/login.php");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { login: "operador", password: "senha" });
  assert.equal(state.authenticatedUser, user);
  assert.equal(state.storedUser, user);
  assert.equal(state.csrfToken, "csrf-1");
  assert.equal(typeof state.persistLog, "function");
  assert.equal(state.redirect, "/dashboard.html");
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, "Entrar");
});

test("credencial recusada informa a API e não cria sessão", async () => {
  const harness = criarFormulario();
  const { config, state } = dependencias(harness);
  config.api.fetch = async () => ({
    ok: false,
    async json() { return { authenticated: false, error: "Credencial inválida." }; },
  });

  bindLoginForm(config);
  await harness.submit();

  assert.deepEqual(state.messages, ["", "Credencial inválida."]);
  assert.equal(state.authenticatedUser, null);
  assert.equal(state.redirect, undefined);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, "Entrar");
});

test("falha de rede registra diagnóstico e sempre libera o botão", async () => {
  const harness = criarFormulario();
  const { config, state } = dependencias(harness);
  const failure = new Error("Servidor indisponível");
  config.api.fetch = async () => { throw failure; };

  bindLoginForm(config);
  await harness.submit();

  assert.equal(state.warnings[0][0], "login.conexao");
  assert.equal(state.warnings[0][1], failure);
  assert.match(state.messages.at(-1), /servidor local/);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, "Entrar");
});

test("formulário já vinculado não registra um segundo handler", () => {
  const harness = criarFormulario();
  const { config } = dependencias(harness);
  bindLoginForm(config);

  assert.equal(bindLoginForm(config), false);
});

function criarFormularioAtivacao() {
  let submitHandler;
  const button = { disabled: false, textContent: "Ativar" };
  let resets = 0;
  const form = {
    dataset: {},
    addEventListener(eventName, handler) {
      assert.equal(eventName, "submit");
      submitHandler = handler;
    },
    querySelector(selector) {
      assert.equal(selector, 'button[type="submit"]');
      return button;
    },
    reset() { resets += 1; },
  };
  return {
    form,
    button,
    get resets() { return resets; },
    submit() { return submitHandler({ preventDefault() {} }); },
  };
}

test("ativação preenche o login, limpa os campos e informa a empresa", async () => {
  const harness = criarFormularioAtivacao();
  const emailInput = { value: "" };
  const documentRef = { querySelector: (selector) => selector === '#login-form [name="email"]' ? emailInput : null };
  const calls = [];
  const notifications = [];
  const activation = { enabled: true, active: true, company_name: "Empresa teste" };

  bindLocalActivationForm({
    form: harness.form,
    activate: async (data) => { calls.push(data); return activation; },
    render: (...args) => calls.push(args),
    notify: (...args) => notifications.push(args),
    documentRef,
    readForm: () => ({ email: "operador@example.test", activation_code: "codigo" }),
  });
  await harness.submit();

  assert.deepEqual(calls[0], [{ enabled: true, active: false }, "", documentRef]);
  assert.deepEqual(calls[1], { email: "operador@example.test", activation_code: "codigo" });
  assert.deepEqual(calls[2], [activation, "", documentRef]);
  assert.equal(emailInput.value, "operador@example.test");
  assert.equal(harness.resets, 1);
  assert.deepEqual(notifications, [["Instalação ativada para Empresa teste.", "sucesso"]]);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, "Ativar este PC");
});

test("ativação com falha mostra o erro e libera o formulário", async () => {
  const harness = criarFormularioAtivacao();
  const documentRef = { querySelector: () => null };
  const rendered = [];
  const failure = new Error("Código expirado.");

  bindLocalActivationForm({
    form: harness.form,
    activate: async () => { throw failure; },
    render: (...args) => rendered.push(args),
    notify: assert.fail,
    documentRef,
    readForm: () => ({ email: "x@example.test" }),
  });
  await harness.submit();

  assert.deepEqual(rendered.at(-1), [{ enabled: true, active: false }, "Código expirado.", documentRef]);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, "Ativar este PC");
});

test("ativação não envia duas requisições simultâneas para o mesmo formulário", async () => {
  const harness = criarFormularioAtivacao();
  let releaseActivation;
  let calls = 0;
  const activationPromise = new Promise((resolve) => { releaseActivation = resolve; });

  bindLocalActivationForm({
    form: harness.form,
    activate: async () => { calls += 1; return activationPromise; },
    render() {},
    notify() {},
    documentRef: { querySelector: () => null },
    readForm: () => ({ email: "x@example.test" }),
  });
  const first = harness.submit();
  await harness.submit();
  assert.equal(calls, 1);

  releaseActivation({ company_name: "Empresa" });
  await first;
  assert.equal(harness.form.dataset.submitting, "0");
});

test("código de ativação usa maiúsculas sem mover o cursor", () => {
  const harness = criarFormularioAtivacao();
  let inputHandler;
  let selection;
  const activationCode = {
    value: "ab12cd",
    selectionStart: 2,
    selectionEnd: 4,
    addEventListener(eventName, handler) {
      assert.equal(eventName, "input");
      inputHandler = handler;
    },
    setSelectionRange(start, end) { selection = [start, end]; },
  };
  harness.form.elements = {
    namedItem(name) {
      assert.equal(name, "activation_code");
      return activationCode;
    },
  };
  bindLocalActivationForm({
    form: harness.form,
    activate: async () => ({}),
    render() {},
    notify() {},
    documentRef: { querySelector: () => null },
  });

  inputHandler();

  assert.equal(activationCode.value, "AB12CD");
  assert.deepEqual(selection, [2, 4]);
});

test("renderizadores escapam valores de licença e mensagens", () => {
  const loginBox = {
    setAttribute() {},
    focus() {},
    innerHTML: "",
  };
  renderLogin("<script>alert(1)</script>", { querySelector: () => loginBox });
  assert.equal(loginBox.innerHTML, '<div class="login-error">&lt;script&gt;alert(1)&lt;/script&gt;</div>');

  const status = { classList: { toggle() {} }, hidden: true, innerHTML: "" };
  const panel = { hidden: false };
  const error = { hidden: true, textContent: "" };
  const documentRef = {
    querySelector(selector) {
      return {
        "#local-license-status": status,
        "#local-activation": panel,
        "#local-activation-error": error,
      }[selector];
    },
  };
  renderLocalActivation({
    enabled: true,
    active: true,
    company_name: "<img>",
    login_domain: "<trace>",
  }, "", documentRef);
  assert.equal(status.innerHTML, "<strong>Licença ativa</strong><small>&lt;img&gt; · @&lt;trace&gt;</small>");
  assert.equal(panel.hidden, true);
});
