import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js?v=202610180001";
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

test("formulário de criação apresenta erro da API e redireciona quando a sessão expira", () => {
  const application = readFileSync(new URL("../interface/js/aplicacao.js", import.meta.url), "utf8");
  const start = application.indexOf('const manifestForm = document.querySelector("#new-manifest-form")');
  const end = application.indexOf('const manifestEditForm = document.querySelector("#edit-manifest-form")', start);
  const handler = application.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(handler, /setFormFeedback\(manifestForm, validationError, "error"\)/);
  assert.match(handler, /error\.status === 401/);
  assert.match(handler, /window\.location\.replace\(pagePath\("login"\)\)/);
  assert.match(handler, /error\.message \|\| "Não foi possível salvar o romaneio/);
  assert.doesNotMatch(handler, /notificar\(/);
});

test("cancelamento da operação apresenta erros da API dentro da tela", () => {
  const application = readFileSync(new URL("../interface/js/aplicacao.js", import.meta.url), "utf8");
  const start = application.indexOf('if (action === "cancel-manifest-progress")');
  const end = application.indexOf('if (action === "back-manifest")', start);
  const handler = application.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(handler, /manifestActionPending = true/);
  assert.match(handler, /await store\.cancelManifest\(manifestId, reason\.trim\(\)\)/);
  assert.match(handler, /type: "error",\s+message: error\.message/);
  assert.doesNotMatch(handler, /notificar\(/);
});
