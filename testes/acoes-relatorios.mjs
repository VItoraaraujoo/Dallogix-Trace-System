import assert from "node:assert/strict";
import test from "node:test";
import { criarTratadorAcoesRelatorios } from "../interface/js/controladores/acoes-relatorios.js";

function preparar(overrides = {}) {
  const calls = { downloads: [], notifications: [], warnings: [], redirects: 0, requests: [] };
  const links = [];
  const timers = [];
  const blobs = [];
  const browser = {
    Blob,
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        return `blob:${blobs.length}`;
      },
      revokeObjectURL(url) { calls.downloads.push({ revoked: url }); },
    },
    document: {
      createElement(tag) {
        assert.equal(tag, "a");
        const link = {
          remove() { link.removed = true; },
          click() { calls.downloads.push({ href: link.href, filename: link.download }); },
        };
        links.push(link);
        return link;
      },
      body: { append(link) { calls.downloads.push({ appended: link }); } },
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
  };
  const store = {
    state: {
      syncStatus: { summary: { PENDENTE: 2, ERRO: 1, PROCESSANDO: 0 } },
      romaneio: "R-10",
      truck: "ABC1D23",
      operationalState: "FINALIZADO",
      loaded: 8,
      planned: 8,
    },
    async loadSyncStatus() { calls.syncStatusLoaded = true; },
  };
  const api = { async fetch(...args) { calls.requests.push(args); return overrides.response; } };
  return {
    calls,
    links,
    timers,
    blobs,
    store,
    tratar: criarTratadorAcoesRelatorios({
      api,
      store,
      notificar: (message) => calls.notifications.push(message),
      redirecionarParaLogin: () => { calls.redirects += 1; },
      registrarAviso: (...args) => calls.warnings.push(args),
      paginaAtual: () => "work",
      browser,
    }),
  };
}

test("exportação CSV preserva campos, neutraliza fórmula e libera URL depois do clique", async () => {
  const { calls, links, timers, blobs, store, tratar } = preparar();
  store.state.romaneio = "=1+1";
  store.state.truck = 'ABC "1"';

  await tratar("export", {});

  assert.equal(calls.syncStatusLoaded, true);
  assert.deepEqual(calls.downloads[1], { href: "blob:1", filename: "dallogix-work.csv" });
  const bytes = new Uint8Array(await blobs[0].arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(bytes.slice(3));
  assert.ok(csv.startsWith('"Campo";"Valor"\n'));
  assert.ok(csv.includes('"Romaneio";"\'=1+1"'));
  assert.ok(csv.includes('"Caminhão";"ABC ""1"""'));
  assert.ok(csv.endsWith('"Sincronização pendente";"3"'));
  assert.equal(links[0].hidden, true);
  assert.equal(timers[0].delay, 60000);
  timers[0].callback();
  assert.equal(links[0].removed, true);
  assert.deepEqual(calls.downloads.at(-1), { revoked: "blob:1" });
  assert.equal(store.state.loaded, 8);
});

test("relatório de auditoria valida o ID antes de chamar a API", async () => {
  const { calls, tratar } = preparar();

  await tratar("download-audit-report", { dataset: { id: "0" } });

  assert.equal(calls.requests.length, 0);
  assert.deepEqual(calls.notifications, ["Romaneio inválido."]);
});

test("sessão expirada no relatório avisa e encaminha para login", async () => {
  const { calls, tratar } = preparar({ response: { status: 401 } });

  await tratar("download-audit-report", { dataset: { id: "10" } });

  assert.equal(calls.redirects, 1);
  assert.deepEqual(calls.notifications, ["Sua sessão expirou. Entre novamente para baixar o relatório."]);
});

test("relatório válido só baixa PDF não vazio", async () => {
  const { calls, blobs, tratar } = preparar({
    response: {
      status: 200,
      ok: true,
      headers: { get: () => "application/pdf" },
      blob: async () => new Blob(["pdf"]),
    },
  });

  await tratar("download-audit-report", { dataset: { id: "10" } });

  assert.equal(calls.requests.length, 1);
  assert.deepEqual(calls.downloads[1], { href: "blob:1", filename: "romaneio-10.pdf" });
  assert.equal(await blobs[0].text(), "pdf");
});
