import assert from "node:assert/strict";
import test from "node:test";
import { refreshCompanyStatusCards } from "../interface/js/funcoes/view.js";

function createCardFixture() {
  const elements = new Map();
  const element = () => ({ className: "", textContent: "", hidden: true });
  const card = {
    dataset: { companyCardId: "8" },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
  };
  const root = {
    querySelectorAll: () => [card],
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
  };
  return { elements, root };
}

test("cards de empresa atualizam status, sinais e resumo sem recriar a tela", () => {
  const { elements, root } = createCardFixture();
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
    [elements.get("[data-company-industrial-status-badge]").textContent, elements.get("[data-company-industrial-status-badge]").className],
    ["PC industrial sem comunicação", "badge red"],
  );
  assert.equal(elements.get("[data-company-connection-badge]").textContent, "PC industrial sem comunicação");
  assert.equal(elements.get('[data-company-metric="industrial-pc"]').textContent, "Offline");
  assert.equal(elements.get('[data-company-metric="dalas-online"]').textContent, "0");
  assert.equal(elements.get('[data-company-last-signal="pc"]').textContent, "2026-10-07 21:38:47.215");
  assert.equal(elements.get('[data-company-summary="machines-online"]').textContent, "0 / 1");
  assert.equal(elements.get('[data-company-summary="machines-online"]').className, "metric-red");
  assert.equal(elements.get('[data-company-summary="machines-offline"]').textContent, "1");
  assert.equal(elements.get('[data-company-summary="machines-offline"]').className, "metric-red");

  refreshCompanyStatusCards([{
    id: 8,
    industrial_pc_status: "OFFLINE",
    total_machines: 1,
    machines_online: 0,
  }], root, {
    stale: true,
    staleMessage: "Dados desatualizados há 12 s. Exibindo a última informação confirmada.",
  });
  assert.equal(elements.get("[data-company-industrial-status-badge]").textContent, "Status desatualizado");
  assert.equal(elements.get("[data-company-industrial-status-badge]").className, "badge yellow");
  assert.equal(elements.get('[data-company-metric="industrial-pc"]').textContent, "Desatualizado");
  assert.match(elements.get("[data-company-status-feedback]").textContent, /Dados desatualizados há 12 s/);
  assert.equal(elements.get("[data-company-status-feedback]").hidden, false);
});
