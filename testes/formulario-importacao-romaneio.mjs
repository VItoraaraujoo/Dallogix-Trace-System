import assert from "node:assert/strict";
import test from "node:test";
import {
  bindCsvManifestImportForm,
  bindPdfManifestImportForm,
} from "../interface/js/controladores/formulario-importacao-romaneio.js?v=202610190001";

function criarFormulario() {
  const handlers = {};
  const fileHandlers = {};
  const fileInput = {
    files: [],
    addEventListener(name, handler) { fileHandlers[name] = handler; },
  };
  const fileName = { textContent: "" };
  const button = { disabled: false };
  const form = {
    addEventListener(name, handler) { handlers[name] = handler; },
    querySelector(selector) {
      return {
        ".file-input": fileInput,
        "[data-file-name]": fileName,
        "button.button": button,
      }[selector] || null;
    },
  };
  return {
    form,
    fileInput,
    fileName,
    button,
    async changeFile() { await fileHandlers.change(); },
    async submit() { await handlers.submit({ preventDefault() {} }); },
  };
}

function criarDocumentRef() {
  const fields = new Map([
    ["#new-manifest-form [name=\"number\"]", { value: "" }],
    ["#new-manifest-form [name=\"scheduled_date\"]", { value: "" }],
    ["#new-manifest-form [name=\"plate\"]", { value: "" }],
    ["#new-manifest-form [name=\"expedidor\"]", { value: "" }],
    ["#new-manifest-form [name=\"driver_name\"]", { value: "" }],
  ]);
  const feedback = {
    "#pdf-import-feedback": { className: "", textContent: "" },
    "#csv-import-feedback": { className: "", textContent: "" },
  };
  const items = {
    innerHTML: "existing",
    inserted: [],
    insertAdjacentHTML(position, html) { this.inserted.push([position, html]); },
  };
  return {
    fields,
    feedback,
    items,
    querySelector(selector) {
      return fields.get(selector) || feedback[selector] || (selector === "#manifest-items tbody" ? items : null);
    },
  };
}

test("PDF preenche dados e item do romaneio e restaura o botão", async () => {
  const harness = criarFormulario();
  const documentRef = criarDocumentRef();
  const formData = { source: "pdf" };
  const store = {
    async importPdf(payload) {
      assert.equal(payload, formData);
      return {
        fields: {
          codigo: "ROM-42",
          data_iso: "2026-10-19",
          placa: "ABC1D23",
          expedidor: "Expedidor",
          motorista: "Motorista",
          quantidade_numero: "12",
        },
        product: { id: 7 },
        missing: [],
      };
    },
  };
  bindPdfManifestImportForm({
    form: harness.form,
    store,
    documentRef,
    formDataFactory: () => formData,
    renderManifestItem: (...args) => JSON.stringify(args.slice(1)),
  });

  harness.fileInput.files = [{ name: "romaneio.pdf" }];
  await harness.changeFile();
  await harness.submit();

  assert.equal(harness.fileName.textContent, "romaneio.pdf");
  assert.deepEqual([...documentRef.fields.values()].map((field) => field.value), [
    "ROM-42", "2026-10-19", "ABC1D23", "Expedidor", "Motorista",
  ]);
  assert.equal(documentRef.items.innerHTML, "");
  assert.deepEqual(documentRef.items.inserted, [["beforeend", '[7,"12"]']]);
  assert.equal(documentRef.feedback["#pdf-import-feedback"].className, "import-feedback is-success");
  assert.match(documentRef.feedback["#pdf-import-feedback"].textContent, /Confira os dados e salve/);
  assert.equal(harness.button.disabled, false);
});

test("erro na importação do PDF aparece no campo e libera o botão", async () => {
  const harness = criarFormulario();
  const documentRef = criarDocumentRef();
  bindPdfManifestImportForm({
    form: harness.form,
    store: { async importPdf() { throw new Error("PDF inválido"); } },
    documentRef,
    formDataFactory: () => ({}),
    renderManifestItem: () => "",
  });

  await harness.submit();

  assert.equal(documentRef.feedback["#pdf-import-feedback"].textContent, "PDF inválido");
  assert.equal(documentRef.feedback["#pdf-import-feedback"].className, "import-feedback is-error");
  assert.equal(harness.button.disabled, false);
});

test("CSV envia o token CSRF, recarrega os romaneios e mostra o resultado", async () => {
  const harness = criarFormulario();
  const documentRef = criarDocumentRef();
  const formData = { source: "csv" };
  const calls = [];
  const store = {
    csrfToken: "csrf-test",
    async loadManifests() { calls.push("reload"); },
  };
  bindCsvManifestImportForm({
    form: harness.form,
    api: {
      async fetch(...args) {
        calls.push(args);
        return {
          ok: true,
          async json() { return { data: { romaneios: 2, items: 7, linhas: 3 } }; },
        };
      },
    },
    store,
    documentRef,
    formDataFactory: () => formData,
  });

  await harness.submit();

  assert.deepEqual(calls[0], ["/api/importar_csv.php", {
    method: "POST",
    headers: { "X-CSRF-Token": "csrf-test" },
    body: formData,
  }]);
  assert.equal(calls[1], "reload");
  assert.match(documentRef.feedback["#csv-import-feedback"].textContent, /2 romaneio\(s\)/);
  assert.equal(documentRef.feedback["#csv-import-feedback"].className, "import-feedback is-success");
  assert.equal(harness.button.disabled, false);
});

test("falha HTTP no CSV não recarrega a lista e mostra a mensagem da API", async () => {
  const harness = criarFormulario();
  const documentRef = criarDocumentRef();
  let reloads = 0;
  bindCsvManifestImportForm({
    form: harness.form,
    api: {
      async fetch() {
        return { ok: false, async json() { return { error: "Arquivo rejeitado" }; } };
      },
    },
    store: { async loadManifests() { reloads += 1; } },
    documentRef,
    formDataFactory: () => ({}),
  });

  await harness.submit();

  assert.equal(reloads, 0);
  assert.equal(documentRef.feedback["#csv-import-feedback"].textContent, "Arquivo rejeitado");
  assert.equal(documentRef.feedback["#csv-import-feedback"].className, "import-feedback is-error");
  assert.equal(harness.button.disabled, false);
});
