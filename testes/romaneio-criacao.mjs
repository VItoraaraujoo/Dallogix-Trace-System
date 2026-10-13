import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js?v=202610130005";
import { validarCadastroRomaneio } from "../interface/js/funcoes/romaneio.js?v=202610130005";
import { importScreen } from "../interface/telas/importar-romaneio/importar-romaneio.js?v=202610130005";

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

test("cadastro rejeita produtos repetidos e aceita itens completos", () => {
  assert.match(
    validarCadastroRomaneio({
      scheduledDate: todayString,
      todayString,
      items: [...validItems, { product_id: "7", quantity: "2" }],
    }),
    /cada produto apenas uma vez/i,
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
