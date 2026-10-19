import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

const root = new URL("../", import.meta.url);

test("a tela de ocorrências busca somente a lista recente e preserva o snapshot", async () => {
  const recent = [{ id: 12, type: "PARADA_MAQUINA" }];
  const store = Object.create(ArmazenamentoTrace.prototype);
  const monitoring = { leituras: { VALIDO: 4 } };
  let requestedUrl = "";
  store.state = { occurrences: [], monitoring };
  store.api = {
    async fetch(url) {
      requestedUrl = url;
      return { ok: true };
    },
  };
  store.jsonResponse = async () => ({ data: recent });

  const result = await store.loadOccurrences();

  assert.equal(requestedUrl, "/api/ocorrencias.php?limit=10");
  assert.deepEqual(result, recent);
  assert.deepEqual(store.state.occurrences, recent);
  assert.equal(store.state.monitoring, monitoring);
});

test("carregamento inicial e atualização da tela não consultam o snapshot completo", () => {
  const pageLoader = readFileSync(new URL("interface/js/controladores/carregador-paginas.js", root), "utf8");
  const screen = readFileSync(new URL("interface/telas/ocorrencias/ocorrencias.js", root), "utf8");

  const initialOccurrenceLoader = pageLoader.slice(
    pageLoader.indexOf("occurrences: () =>"),
    pageLoader.indexOf("summary: () =>", pageLoader.indexOf("occurrences: () =>")),
  );
  const liveOccurrenceLoader = pageLoader.slice(
    pageLoader.indexOf("occurrences: () =>", pageLoader.indexOf("const carregadoresAoVivo")),
    pageLoader.indexOf("summary: () =>", pageLoader.indexOf("const carregadoresAoVivo")),
  );
  assert.match(initialOccurrenceLoader, /store\.loadOccurrences\(\), store\.loadActiveLoading\(\)/);
  assert.match(liveOccurrenceLoader, /occurrences: \(\) => \[store\.loadOccurrences\(\)\]/);
  assert.doesNotMatch(initialOccurrenceLoader, /store\.loadMonitoring\(\)/);
  assert.doesNotMatch(liveOccurrenceLoader, /store\.loadMonitoring\(\)/);
  assert.match(screen, /store\.state\.occurrences/);
});

test("GET de ocorrências libera a sessão e valida o limite antes da consulta", () => {
  const endpoint = readFileSync(new URL("servidor/api/operacoes/ocorrencias.php", root), "utf8");
  const storage = readFileSync(new URL("interface/js/classes/ArmazenamentoTrace.js", root), "utf8");
  const indexes = readFileSync(new URL("banco-de-dados/migrations/018_consultas_operacionais.sql", root), "utf8");
  const getBranch = endpoint.split('if ($_SERVER["REQUEST_METHOD"] === "GET") {')[1]?.split("\n}")[0] || "";

  assert.ok(getBranch.indexOf("session_write_close()") < getBranch.indexOf("obter_conexao_banco()"));
  assert.match(getBranch, /\$limit < 1 \|\| \$limit > 50/);
  assert.match(getBranch, /LIMIT :limit/);
  assert.match(getBranch, /bindValue\(":limit", \$limit, PDO::PARAM_INT\)/);
  assert.match(indexes, /idx_occurrence_company_id\s+ON ocorrencias \(company_id, id\)/);
  assert.match(storage, /async createOccurrence\(data\)[\s\S]*?await this\.loadOccurrences\(\)/);
});
