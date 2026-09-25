import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { physicalStateBadge } from "../interface/js/funcoes/view.js";

const source = readFileSync(new URL("../interface/js/funcoes/view.js", import.meta.url), "utf8");

test("não converte operação ociosa em confirmação de parada física", () => {
  const badge = physicalStateBadge({ clp_status: "ONLINE", operational_status: "OCIOSA" });
  assert.match(badge, /Desconhecido · sem retorno físico do CLP/);
  assert.doesNotMatch(badge, /Ociosa|Parada confirmada/);
});

test("não usa um retorno físico quando o CLP está offline", () => {
  const badge = physicalStateBadge({ clp_status: "OFFLINE", physical_running: false });
  assert.match(badge, /Desconhecido · sem comunicação com o CLP/);
  assert.doesNotMatch(badge, /Parada reportada/);
});

test("só apresenta estado físico quando o CLP online reporta booleano explícito", () => {
  assert.match(physicalStateBadge({ clp_status: "ONLINE", physical_running: true }), /Operação reportada pelo CLP/);
  assert.match(physicalStateBadge({ clp_status: "ONLINE", physical_running: false }), /Parada reportada pelo CLP/);
  assert.match(physicalStateBadge({ clp_status: "ONLINE", physical_running: "false" }), /Desconhecido · sem retorno físico do CLP/);
});

test("a linha Estado físico da Dala usa o sinal físico, não o status operacional", () => {
  assert.match(source, /<dt>Estado físico<\/dt><dd>\$\{physicalStateBadge\(machine\)\}<\/dd>/);
});

test("painel, monitoramento e detalhe da Dala usam o mesmo sinal físico", () => {
  for (const path of ["painel.js", "monitoramento.js", "dalas.js"]) {
    const screen = readFileSync(new URL(`../interface/js/telas/${path}`, import.meta.url), "utf8");
    assert.match(screen, /physicalStateBadge\((?:machine|operation)\)/, path);
    assert.doesNotMatch(screen, /Estado físico[^\n]{0,160}operationalBadge\(/, path);
  }
});
