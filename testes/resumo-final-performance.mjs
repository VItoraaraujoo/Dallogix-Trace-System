import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";
import { criarCarregadorPaginas } from "../interface/js/controladores/carregador-paginas.js";
import { summary } from "../interface/telas/resumo-final/resumo-final.js";
import { ServicoObservabilidade } from "../interface/js/servicos/ServicoObservabilidade.js";

const root = new URL("../", import.meta.url);

test("Resumo final consulta e renderiza seu estado dedicado", async () => {
  const summaryData = {
    leituras: { VALIDO: 7, SEM_LEITURA: 2 },
    ocorrencias: [{ id: 11 }, { id: 12 }],
    sync_pendente: 3,
  };
  const calls = [];
  const store = {
    state: {
      summaryMonitoring: null,
      monitoring: { leituras: { VALIDO: 999 }, ocorrencias: [], sync_pendente: 999 },
      loaded: 4,
      planned: 10,
      operationalState: "CARREGANDO",
      romaneio: "R-10",
      truck: "ABC1D23",
    },
    async loadSummaryMonitoring() { calls.push("summary"); this.state.summaryMonitoring = summaryData; },
    async loadMonitoring() { calls.push("full-snapshot"); },
    async loadActiveLoading() { calls.push("active-loading"); },
  };

  const loader = criarCarregadorPaginas({
    store,
    obterPerfil: () => "OPERADOR",
    obterModoInstalacao: () => "local",
    idDaConsulta: () => null,
    registrarAviso: () => {},
  });
  await loader.carregarDadosIniciais("summary");
  await Promise.all(loader.obterConsultasAoVivo("summary"));

  assert.deepEqual(calls, ["summary", "active-loading", "summary", "active-loading"]);
  const html = summary(store);
  assert.match(html, />7<\/strong>/);
  assert.match(html, />2<\/strong>/);
  assert.match(html, />3<\/strong>/);
  assert.doesNotMatch(html, />999<\/strong>/);
});

test("serviço mantém os dados de resumo separados dos snapshots completos", async () => {
  const result = {
    leituras: { VALIDO: 1 },
    ocorrencias: [],
    sync_pendente: 0,
  };
  let url = "";
  const state = { monitoring: { sentinel: true }, summaryMonitoring: null };
  const service = new ServicoObservabilidade({
    api: { async fetch(requestUrl) { url = requestUrl; return { ok: true }; } },
    state,
    jsonHeaders: () => ({}),
    jsonResponse: async () => ({ data: result }),
  });

  assert.equal(await service.loadSummaryMonitoring(), result);
  assert.equal(url, "/api/monitoramento.php?view=resumo");
  assert.equal(state.summaryMonitoring, result);
  assert.deepEqual(state.monitoring, { sentinel: true });
});

test("encerrar carregamento atualiza os indicadores do resumo sem baixar o snapshot geral", async () => {
  const calls = [];
  const store = new ArmazenamentoTrace();
  store.state.loadingId = 25;
  store.state.operationalState = "CARREGANDO";
  store.state.running = true;
  store.api.fetch = async (url, options) => {
    calls.push([url, options]);
    return { ok: true };
  };
  store.jsonResponse = async () => ({ data: { id: 25 } });
  store.loadSummaryMonitoring = async () => calls.push(["summary"]);
  store.loadEquipments = async (options) => calls.push(["equipments", options]);
  store.loadMonitoring = async () => calls.push(["full-snapshot"]);

  await store.finishLoading("Conferido pelo operador");

  assert.equal(store.state.operationalState, "FINALIZADO");
  assert.equal(store.state.running, false);
  assert.equal(calls[0][0], "/api/encerrar_carregamento.php");
  assert.ok(calls.some(([kind]) => kind === "summary"));
  assert.ok(calls.some(([kind, options]) => kind === "equipments" && options.force === true));
  assert.equal(calls.some(([kind]) => kind === "full-snapshot"), false);
});

test("Resumo final usa endpoint limitado, mantendo o snapshot completo para outros fluxos", () => {
  const endpoint = readFileSync(new URL("servidor/api/monitoramento/monitoramento.php", root), "utf8");
  const service = readFileSync(new URL("servidor/src/Aplicacao/ServicoMonitoramento.php", root), "utf8");
  const storage = readFileSync(new URL("interface/js/classes/ArmazenamentoTrace.js", root), "utf8");
  const alertScreen = readFileSync(new URL("interface/telas/alertas/alertas.js", root), "utf8");

  assert.match(endpoint, /"resumo"\s*=>\s*\$service->obterResumoFinal/);
  assert.match(endpoint, /default\s*=>\s*\$service->obterInstantaneo/);
  assert.match(service, /function obterResumoFinal\(int \$companyId, int \$periodDays = 30\)/);
  assert.match(storage, /summaryMonitoring: null/);
  assert.match(storage, /alertMonitoring: null/);
  assert.match(alertScreen, /store\.state\.alertMonitoring/);
});
