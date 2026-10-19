import assert from "node:assert/strict";
import test from "node:test";
import { ServicoObservabilidade } from "../interface/js/servicos/ServicoObservabilidade.js";

function criarServico(respostas = {}) {
  const calls = [];
  const state = {};
  const api = {
    async fetch(url, options = {}) {
      calls.push({ url, options });
      const response = respostas[url] || { ok: true, payload: { data: [] } };
      return typeof response === "function" ? response(url, options) : response;
    },
  };
  const service = new ServicoObservabilidade({
    api,
    state,
    jsonHeaders: () => ({ "Content-Type": "application/json", "X-CSRF-Token": "csrf-test" }),
    jsonResponse: async (response, fallback) => {
      if (!response.ok) throw new Error(response.error || fallback);
      return response.payload;
    },
  });
  return { calls, service, state };
}

test("status de Dalas e dispositivos atualizam somente seus dados", async () => {
  const { calls, service, state } = criarServico({
    "/api/status_dalas.php": { ok: true, payload: { data: [{ id: 2, status: "ONLINE" }] } },
    "/api/status_dispositivos.php": { ok: true, payload: { data: [{ device_type: "CLP", status: "ONLINE" }] } },
  });

  const dalas = await service.loadDalaStatuses();
  const devices = await service.loadDeviceStatuses();

  assert.deepEqual(dalas, [{ id: 2, status: "ONLINE" }]);
  assert.deepEqual(devices, [{ device_type: "CLP", status: "ONLINE" }]);
  assert.equal(state.dalaStatuses, dalas);
  assert.equal(state.deviceStatuses, devices);
  assert.ok(Number.isFinite(Date.parse(state.deviceStatusesUpdatedAt)));
  assert.deepEqual(calls.map(({ url }) => url), ["/api/status_dalas.php", "/api/status_dispositivos.php"]);
});

test("alertas carregam resumo reduzido e registram atualização do estado", async () => {
  const data = { leituras: { VALIDO: 4 }, dispositivos: [], maquinas: [] };
  const { calls, service, state } = criarServico({
    "/api/monitoramento.php?view=alertas": { ok: true, payload: { data } },
  });

  const result = await service.loadAlertMonitoring();

  assert.deepEqual(result, data);
  assert.equal(state.alertMonitoring, data);
  assert.ok(Number.isFinite(Date.parse(state.alertMonitoringUpdatedAt)));
  assert.deepEqual(calls.map(({ url }) => url), ["/api/monitoramento.php?view=alertas"]);
});

test("resumo final carrega dados mínimos sem sobrescrever o snapshot operacional", async () => {
  const data = { leituras: { VALIDO: 2 }, ocorrencias: [], sync_pendente: 1 };
  const { calls, service, state } = criarServico({
    "/api/monitoramento.php?view=resumo": { ok: true, payload: { data } },
  });
  state.monitoring = { maquinas: [{ id: 8 }] };

  const result = await service.loadSummaryMonitoring();

  assert.equal(result, data);
  assert.equal(state.summaryMonitoring, data);
  assert.deepEqual(state.monitoring, { maquinas: [{ id: 8 }] });
  assert.ok(Number.isFinite(Date.parse(state.summaryMonitoringUpdatedAt)));
  assert.deepEqual(calls.map(({ url }) => url), ["/api/monitoramento.php?view=resumo"]);
});

test("persistência do log mantém token CSRF e corpo JSON", async () => {
  const { calls, service } = criarServico();
  const record = { level: "erro", context: "operacao", message: "Falha de rede" };

  const response = await service.persistFrontendLog(record);

  assert.equal(response.ok, true);
  assert.equal(calls[0].url, "/api/logs_erros.php");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["X-CSRF-Token"], "csrf-test");
  assert.deepEqual(JSON.parse(calls[0].options.body), record);
});

test("resolver item da fila morta atualiza os dois painéis de diagnóstico", async () => {
  const responses = {
    "/api/sync_dead_letter.php?id=17": { ok: true, payload: { data: { id: 17, status: "RESOLVIDO" } } },
    "/api/sync_dead_letter.php": { ok: true, payload: { data: [] } },
    "/api/diagnostico.php": { ok: true, payload: { data: { queue: 0 } } },
  };
  const { calls, service, state } = criarServico(responses);

  const result = await service.updateDeadLetter(17, "RESOLVER", "Evento conferido");

  assert.deepEqual(result, { id: 17, status: "RESOLVIDO" });
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    id: 17,
    action: "RESOLVER",
    resolution_note: "Evento conferido",
  });
  assert.deepEqual(state.deadLetters, []);
  assert.deepEqual(state.technicalDiagnostics, { queue: 0 });
  assert.deepEqual(new Set(calls.slice(1).map(({ url }) => url)), new Set([
    "/api/sync_dead_letter.php",
    "/api/diagnostico.php",
  ]));
});
