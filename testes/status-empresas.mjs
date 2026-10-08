import assert from "node:assert/strict";
import test from "node:test";
import { createCompanyStatusController } from "../interface/js/controladores/status-empresas.js";
import { refreshCompanyStatusCards } from "../interface/js/funcoes/view.js";

function criarAmbiente() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let tarefa = null;
  const limpas = [];
  globalThis.window = {
    setTimeout(callback, delay) {
      const id = Symbol("timer");
      const disparar = () => {
        if (tarefa?.id === id) tarefa = null;
        return callback();
      };
      tarefa = { callback: disparar, delay, id };
      return id;
    },
    clearTimeout(id) {
      limpas.push(id);
      if (tarefa?.id === id) tarefa = null;
    },
  };
  globalThis.document = { hidden: false };
  return {
    get tarefa() { return tarefa; },
    limpas,
    restaurar() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    },
  };
}

test("status das empresas atualizam nas telas de Empresas e Central Master", async () => {
  const ambiente = criarAmbiente();
  let pagina = "companies";
  let consultas = 0;
  let atualizacoes = 0;
  const controller = createCompanyStatusController({
    store: { async loadCompanies() { consultas += 1; } },
    getPage: () => pagina,
    refreshView: () => { atualizacoes += 1; },
    intervalMs: 15000,
    hiddenIntervalMs: 60000,
  });

  try {
    controller.start();
    assert.equal(ambiente.tarefa.delay, 15000);
    ambiente.tarefa.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual([consultas, atualizacoes], [1, 1]);
    assert.equal(ambiente.tarefa.delay, 15000);

    pagina = "master-home";
    globalThis.document.hidden = true;
    ambiente.tarefa.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual([consultas, atualizacoes], [2, 2]);
    assert.equal(ambiente.tarefa.delay, 60000);
  } finally {
    controller.stop();
    assert.equal(ambiente.limpas.length, 1);
    ambiente.restaurar();
  }
});

test("poll de empresas atrasado não redesenha uma tela após navegação", async () => {
  const ambiente = criarAmbiente();
  let pagina = "companies";
  let liberarConsulta;
  let atualizacoes = 0;
  const controller = createCompanyStatusController({
    store: { loadCompanies: () => new Promise((resolve) => { liberarConsulta = resolve; }) },
    getPage: () => pagina,
    refreshView: () => { atualizacoes += 1; },
  });

  try {
    controller.start();
    ambiente.tarefa.callback();
    pagina = "work";
    controller.stop();
    liberarConsulta();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(atualizacoes, 0);
    assert.equal(ambiente.tarefa, null);
  } finally {
    controller.stop();
    ambiente.restaurar();
  }
});

test("falha de consulta avisa que o último status confirmado está desatualizado", async () => {
  const ambiente = criarAmbiente();
  let stale = false;
  const controller = createCompanyStatusController({
    store: { async loadCompanies() { throw new Error("Sessão expirada."); } },
    getPage: () => "companies",
    refreshView: (state) => { stale = state.stale; },
  });

  try {
    controller.start();
    ambiente.tarefa.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stale, true);
    assert.equal(ambiente.tarefa.delay, 15000);
  } finally {
    controller.stop();
    ambiente.restaurar();
  }
});

test("cards atualizam online, offline e último sinal sem recriar a tela", () => {
  const elementos = new Map();
  const element = () => ({ className: "", textContent: "" });
  const card = {
    dataset: { companyCardId: "8" },
    querySelector(selector) {
      if (!elementos.has(selector)) elementos.set(selector, element());
      return elementos.get(selector);
    },
  };
  const root = {
    querySelectorAll: () => [card],
    querySelector(selector) {
      if (!elementos.has(selector)) elementos.set(selector, element());
      return elementos.get(selector);
    },
  };

  refreshCompanyStatusCards([{
    id: 8,
    archived: false,
    industrial_pc_status: "OFFLINE",
    industrial_pc_last_seen_at: "2026-10-07 21:38:47.215",
    last_signal_at: "2026-10-08 02:12:00.000",
    total_machines: 1,
    machines_online: 0,
  }], root);

  assert.deepEqual(
    [elementos.get("[data-company-industrial-status-badge]").textContent, elementos.get("[data-company-industrial-status-badge]").className],
    ["PC industrial sem comunicação", "badge red"],
  );
  assert.equal(elementos.get("[data-company-connection-badge]").textContent, "PC industrial sem comunicação");
  assert.equal(elementos.get('[data-company-metric="industrial-pc"]').textContent, "Offline");
  assert.equal(elementos.get('[data-company-metric="dalas-online"]').textContent, "0");
  assert.equal(elementos.get('[data-company-last-signal="pc"]').textContent, "2026-10-07 21:38:47.215");
  assert.equal(elementos.get('[data-company-summary="machines-online"]').textContent, "0 / 1");
  assert.equal(elementos.get('[data-company-summary="machines-online"]').className, "metric-red");
  assert.equal(elementos.get('[data-company-summary="machines-offline"]').textContent, "1");
  assert.equal(elementos.get('[data-company-summary="machines-offline"]').className, "metric-red");

  refreshCompanyStatusCards([{
    id: 8,
    industrial_pc_status: "OFFLINE",
    total_machines: 1,
    machines_online: 0,
  }], root, { stale: true });
  assert.equal(elementos.get("[data-company-industrial-status-badge]").textContent, "Status desatualizado");
  assert.equal(elementos.get("[data-company-industrial-status-badge]").className, "badge yellow");
  assert.equal(elementos.get('[data-company-metric="industrial-pc"]').textContent, "Desatualizado");
  assert.match(elementos.get("[data-company-status-feedback]").textContent, /última consulta confirmada/);
  assert.equal(elementos.get("[data-company-status-feedback]").hidden, false);
});
