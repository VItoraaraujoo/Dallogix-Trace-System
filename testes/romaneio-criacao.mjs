import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js?v=202610180001";
import { ServicoRomaneios } from "../interface/js/servicos/ServicoRomaneios.js?v=202610190001";
import {
  bindManifestCreationForm,
  bindManifestEditForm,
} from "../interface/js/controladores/formulario-romaneio.js?v=202610190001";
import { validarCadastroRomaneio } from "../interface/js/funcoes/romaneio.js?v=202610190001";
import { importScreen } from "../interface/telas/importar-romaneio/importar-romaneio.js?v=202610190001";
import { manifestView } from "../interface/telas/romaneio/romaneio.js?v=202610130006";
import { manifests } from "../interface/telas/romaneios/romaneios.js?v=202610130006";

const todayString = "2026-10-13";
const validItems = [{ product_id: "7", quantity: "12" }];

test("cadastro recusa data anterior ao relógio do PC industrial", () => {
  assert.match(
    validarCadastroRomaneio({
      scheduledDate: "2026-10-12",
      todayString,
      items: validItems,
    }),
    /data igual ou posterior/i,
  );
});

test("cadastro não ignora linhas de item incompletas", () => {
  assert.match(
    validarCadastroRomaneio({
      scheduledDate: todayString,
      todayString,
      items: [...validItems, { product_id: "", quantity: "3" }],
    }),
    /produto para o item 2/i,
  );
  assert.match(
    validarCadastroRomaneio({
      scheduledDate: todayString,
      todayString,
      items: [{ product_id: "7", quantity: "1.5" }],
    }),
    /quantidade inteira/i,
  );
});

test("cadastro aceita linhas separadas do mesmo produto", () => {
  assert.equal(
    validarCadastroRomaneio({
      scheduledDate: todayString,
      todayString,
      items: [...validItems, { product_id: "7", quantity: "2" }],
    }),
    "",
  );
  assert.equal(
    validarCadastroRomaneio({ scheduledDate: todayString, todayString, items: validItems }),
    "",
  );
});

test("a tela de novo romaneio tem feedback visível para erros e validações", () => {
  const html = importScreen({ state: { products: [] } });
  assert.match(html, /<form id="new-manifest-form">/);
  assert.match(html, /data-form-feedback role="status" aria-live="polite" hidden/);
});

test("resposta de criação bem-sucedida não depende de recarregar a listagem", async () => {
  const store = Object.create(ArmazenamentoTrace.prototype);
  const created = { id: 123, number: "ROM-TESTE", status: "AGUARDANDO" };
  let sentRequest;
  store.csrfToken = "csrf-test";
  store.api = {
    async fetch(url, options) {
      sentRequest = { url, options };
      return { ok: true, async json() { return { data: created }; } };
    },
  };
  store.servicoRomaneios = new ServicoRomaneios({
    api: store.api,
    state: {},
    jsonHeaders: () => ({ "X-CSRF-Token": store.csrfToken }),
    jsonResponse: async (response) => response.json(),
    getCsrfToken: () => store.csrfToken,
    setManifestRows: () => {},
  });
  store.loadManifests = async () => {
    throw new Error("A listagem falhou depois de o servidor salvar o romaneio.");
  };

  assert.deepEqual(await store.createManifest({ number: created.number }), created);
  assert.equal(sentRequest.url, "/api/romaneios.php");
  assert.equal(sentRequest.options.method, "POST");
  assert.equal(JSON.parse(sentRequest.options.body).number, created.number);
});

test("cancelamento não vira falha se uma atualização posterior for indisponível", async () => {
  const store = Object.create(ArmazenamentoTrace.prototype);
  let sentRequest;
  store.csrfToken = "csrf-test";
  store.api = {
    async fetch(url, options) {
      sentRequest = { url, options };
      return { ok: true, async json() { return { data: { id: 123, status: "CANCELADO" } }; } };
    },
  };
  store.loadManifests = async () => { throw new Error("Falha na atualização da lista."); };
  store.loadMonitoring = async () => { throw new Error("Falha no monitoramento."); };
  store.loadActiveLoading = async () => { throw new Error("Falha no estado do carregamento."); };
  store.loadEquipments = async () => { throw new Error("Falha nos equipamentos."); };

  assert.deepEqual(await store.cancelManifest(123, "Solicitação do operador"), { id: 123, status: "CANCELADO" });
  assert.equal(sentRequest.url, "/api/romaneios.php");
  assert.equal(sentRequest.options.method, "PATCH");
  assert.equal(sentRequest.options.headers["X-CSRF-Token"], "csrf-test");
  assert.deepEqual(JSON.parse(sentRequest.options.body), {
    action: "cancel",
    romaneio_id: 123,
    justification: "Solicitação do operador",
  });
});

test("detalhe bloqueia clique repetido e exibe o erro de cancelamento", () => {
  const store = {
    state: {
      manifestDetail: { id: 123, number: "ROM-123", status: "EM_ANDAMENTO", active_loading_id: 9, items: [] },
      userRole: "SUPERVISOR",
      manifestActionFeedback: { type: "status", message: "Cancelando operação…" },
      manifestActionPending: true,
    },
    manifests: [],
  };
  const html = manifestView(store);
  assert.match(html, /data-manifest-action-feedback role="status" aria-live="polite"/);
  assert.match(html, /Cancelando operação…/);
  assert.match(html, /disabled aria-busy="true"/);

  store.state.manifestActionPending = false;
  store.state.manifestActionFeedback = { type: "error", message: "Coloque a operação em pausa." };
  const errorHtml = manifestView(store);
  assert.match(errorHtml, /data-manifest-action-feedback role="alert" aria-live="assertive"/);
  assert.match(errorHtml, /Coloque a operação em pausa\./);
});

test("mensagem de sucesso do cancelamento permanece visível ao voltar para a lista", () => {
  const html = manifests({
    state: {
      userRole: "SUPERVISOR",
      manifestFilters: {},
      manifestMeta: { page: 1, pages: 1, total: 1 },
      manifestActionFeedback: { type: "success", message: "Operação cancelada e registrada na auditoria." },
    },
    manifests: [],
  });
  assert.match(html, /Operação cancelada e registrada na auditoria\./);
});

function criarFormularioSimulado() {
  let submitHandler;
  const feedback = { textContent: "", hidden: true, className: "" };
  const buttons = [{ disabled: false }, { disabled: false }];
  const form = {
    dataset: {},
    isConnected: true,
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
    async submit() {
      let prevented = false;
      await submitHandler({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    },
  };
}

test("cadastro envia itens repetidos, libera os botões e navega após sucesso", async () => {
  const harness = criarFormularioSimulado();
  const sentManifest = [];
  const navigation = [];
  const items = [...validItems, { product_id: "7", quantity: "2" }];
  bindManifestCreationForm({
    form: harness.form,
    store: { async createManifest(manifest) { sentManifest.push(manifest); } },
    navigate: async (...args) => navigation.push(args),
    now: () => new Date(2026, 9, 13),
    readForm: () => ({
      number: "ROM-123",
      scheduled_date: todayString,
      plate: "ABC1D23",
      expedidor: "Expedidor",
      driver_name: "Motorista",
    }),
    readItems: () => items,
    onUnauthorized: (error) => { throw error; },
  });

  await harness.submit();

  assert.deepEqual(sentManifest, [{
    number: "ROM-123",
    scheduled_date: todayString,
    plate: "ABC1D23",
    expedidor: "Expedidor",
    driver_name: "Motorista",
    items: [
      { product_id: "7", quantity: 12 },
      { product_id: "7", quantity: 2 },
    ],
  }]);
  assert.deepEqual(navigation, [["manifests"]]);
  assert.equal(harness.feedback.textContent, "Romaneio cadastrado com sucesso.");
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => button.disabled === false));
});

test("cadastro apresenta erro da API, restaura botões e redireciona em sessão expirada", async () => {
  const harness = criarFormularioSimulado();
  const unauthorized = [];
  const apiError = Object.assign(new Error("Sessão expirada"), { status: 401 });
  bindManifestCreationForm({
    form: harness.form,
    store: { async createManifest() { throw apiError; } },
    navigate: async () => assert.fail("não deve navegar após sessão expirada"),
    now: () => new Date(2026, 9, 13),
    readForm: () => ({ scheduled_date: todayString }),
    readItems: () => validItems,
    onUnauthorized: (error) => unauthorized.push(error),
  });

  await harness.submit();

  assert.deepEqual(unauthorized, [apiError]);
  assert.equal(harness.feedback.textContent, "Salvando romaneio…");
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => button.disabled === false));
});

test("cadastro mostra erro da API sem perder o feedback e sempre libera os botões", async () => {
  const harness = criarFormularioSimulado();
  bindManifestCreationForm({
    form: harness.form,
    store: { async createManifest() { throw new Error("Banco indisponível"); } },
    navigate: async () => assert.fail("não deve navegar após erro da API"),
    now: () => new Date(2026, 9, 13),
    readForm: () => ({ scheduled_date: todayString }),
    readItems: () => validItems,
    onUnauthorized: (error) => { throw error; },
  });

  await harness.submit();

  assert.equal(harness.feedback.textContent, "Banco indisponível");
  assert.equal(harness.feedback.className, "form-feedback is-error");
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => button.disabled === false));
});

test("edição preserva itens repetidos e navega para o romaneio atualizado", async () => {
  const harness = criarFormularioSimulado();
  harness.form.dataset.id = "456";
  const sentManifest = [];
  const navigation = [];
  const notifications = [];
  bindManifestEditForm({
    form: harness.form,
    store: { async updateManifest(manifest) { sentManifest.push(manifest); } },
    navigate: async (...args) => navigation.push(args),
    notify: (message) => notifications.push(message),
    now: () => new Date(2026, 9, 13),
    readForm: () => ({
      number: "ROM-456",
      scheduled_date: todayString,
      plate: "ABC1D23",
      expedidor: "Expedidor",
      driver_name: "Motorista",
    }),
    readItems: () => [...validItems, { product_id: "7", quantity: "2" }, { product_id: "", quantity: "0" }],
  });

  await harness.submit();

  assert.deepEqual(sentManifest, [{
    romaneio_id: "456",
    number: "ROM-456",
    scheduled_date: todayString,
    plate: "ABC1D23",
    expedidor: "Expedidor",
    driver_name: "Motorista",
    items: [...validItems, { product_id: "7", quantity: "2" }],
  }]);
  assert.deepEqual(navigation, [["manifest", "?id=456"]]);
  assert.deepEqual(notifications, ["Romaneio atualizado."]);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => button.disabled === false));
});

test("edição informa falha da API e libera os botões no finally", async () => {
  const harness = criarFormularioSimulado();
  harness.form.dataset.id = "456";
  const notifications = [];
  bindManifestEditForm({
    form: harness.form,
    store: { async updateManifest() { throw new Error("Falha ao atualizar romaneio"); } },
    navigate: async () => assert.fail("não deve navegar após falha"),
    notify: (message) => notifications.push(message),
    now: () => new Date(2026, 9, 13),
    readForm: () => ({ scheduled_date: todayString }),
    readItems: () => validItems,
  });

  await harness.submit();

  assert.deepEqual(notifications, ["Falha ao atualizar romaneio"]);
  assert.equal(harness.form.dataset.submitting, "0");
  assert.ok(harness.buttons.every((button) => button.disabled === false));
});

test("a aplicação conecta o controlador ao redirecionamento de sessão expirada", () => {
  const application = readFileSync(new URL("../interface/js/aplicacao.js", import.meta.url), "utf8");
  assert.match(application, /bindManifestCreationForm\(\{/);
  assert.match(application, /bindManifestEditForm\(\{/);
  assert.match(application, /sessionStorage\.setItem\("trace-login-message", error\.message\)/);
  assert.match(application, /window\.location\.replace\(pagePath\("login"\)\)/);
});

test("cancelamento da operação apresenta erros da API dentro da tela", () => {
  const handler = readFileSync(
    new URL("../interface/js/controladores/acoes-operacionais.js", import.meta.url),
    "utf8",
  );
  const start = handler.indexOf("async function cancelarOperacao");
  const end = handler.indexOf("async function selecionarCarregamento", start);
  const cancelHandler = handler.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(cancelHandler, /manifestActionPending = true/);
  assert.match(cancelHandler, /await store\.cancelManifest\(manifestId, reason\.trim\(\)\)/);
  assert.match(cancelHandler, /type: "error",\s+message: error\.message/);
  assert.doesNotMatch(cancelHandler, /notificar\(/);
});
