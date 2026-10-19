import assert from "node:assert/strict";
import test from "node:test";
import { bindProductForm } from "../interface/js/controladores/formulario-produto.js?v=202610190001";

function criarFormulario() {
  let submitHandler;
  const feedback = { textContent: "", hidden: true, className: "" };
  const buttons = [{ disabled: false }, { disabled: false }];
  const form = {
    dataset: {},
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

const validProduct = { name: "Produto A", barcode: "12345678" };

test("cadastro de produto atualiza o estado e a tela depois de salvar", async () => {
  const harness = criarFormulario();
  const saved = [];
  const notifications = [];
  let renders = 0;
  const store = {
    state: { productFormOpen: true, editingProductId: 12 },
    async createProduct(product) { saved.push(product); },
  };
  bindProductForm({
    form: harness.form,
    store,
    render: () => { renders += 1; },
    notify: (message) => notifications.push(message),
    onUnauthorized: assert.fail,
    readForm: () => validProduct,
  });

  await harness.submit();

  assert.deepEqual(saved, [validProduct]);
  assert.deepEqual(notifications, ["Produto cadastrado."]);
  assert.deepEqual(store.state, { productFormOpen: false, editingProductId: null });
  assert.equal(renders, 1);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => !button.disabled));
});

test("edição de produto preserva o identificador e libera o envio após resposta", async () => {
  const harness = criarFormulario();
  harness.form.dataset.editing = "42";
  const updates = [];
  const store = {
    state: { productFormOpen: true, editingProductId: 42 },
    async updateProduct(product) { updates.push(product); },
  };
  bindProductForm({
    form: harness.form,
    store,
    render() {},
    notify() {},
    onUnauthorized: assert.fail,
    readForm: () => validProduct,
  });

  await harness.submit();

  assert.deepEqual(updates, [{ id: "42", ...validProduct }]);
  assert.ok(harness.buttons.every((button) => !button.disabled));
});

test("produto inválido não chama a API e mostra o motivo no formulário", async () => {
  const harness = criarFormulario();
  let apiCalls = 0;
  const notifications = [];
  bindProductForm({
    form: harness.form,
    store: {
      state: {},
      async createProduct() { apiCalls += 1; },
    },
    render() {},
    notify: (message) => notifications.push(message),
    onUnauthorized: assert.fail,
    readForm: () => ({ name: "Produto A", barcode: "abc" }),
  });

  await harness.submit();

  assert.equal(apiCalls, 0);
  assert.match(harness.feedback.textContent, /código de barras/);
  assert.equal(harness.feedback.className, "form-feedback is-error");
  assert.deepEqual(notifications, [harness.feedback.textContent]);
});

test("sessão expirada chama o redirecionamento e libera os botões", async () => {
  const harness = criarFormulario();
  const unauthorized = Object.assign(new Error("Sessão expirada"), { status: 401 });
  const redirected = [];
  bindProductForm({
    form: harness.form,
    store: { state: {}, async createProduct() { throw unauthorized; } },
    render() {},
    notify: assert.fail,
    onUnauthorized: (error) => redirected.push(error),
    readForm: () => validProduct,
  });

  await harness.submit();

  assert.deepEqual(redirected, [unauthorized]);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => !button.disabled));
});
