import assert from "node:assert/strict";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";
import { ServicoDalas } from "../interface/js/servicos/ServicoDalas.js";
import { ServicoLeiturasOperacionais } from "../interface/js/servicos/ServicoLeiturasOperacionais.js";

test("armazenamento preserva resposta válida como dados", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  const response = new Response(JSON.stringify({ data: { total: 3 } }), { status: 200 });

  await assert.deepEqual(
    await armazenamento.jsonResponse(response, "fallback"),
    { data: { total: 3 } },
  );
});

test("pedidos simultâneos de Dalas aguardam e compartilham a mesma carga", async () => {
  const state = {
    equipments: [],
    equipmentsLoaded: false,
    equipmentsLoading: false,
    equipmentsError: "",
  };
  const service = new ServicoDalas({
    api: {}, state, jsonHeaders() {}, jsonResponse() {},
    fetchAllPages: () => {
      chamadas += 1;
      if (chamadas > 1) return Promise.resolve([{ equipment_code: "dala_c", name: "Dala C" }]);
      return new Promise((resolve) => { concluirCarga = resolve; });
    },
  });
  let concluirCarga;
  let chamadas = 0;

  const primeiraTela = service.loadAll();
  const segundaTela = service.loadAll({ force: true });

  assert.equal(chamadas, 1);
  assert.equal(state.equipmentsLoading, true);
  concluirCarga([
    { equipment_code: "dala_b", name: "Dala B" },
    { equipment_code: "dala_a", name: "Dala A" },
  ]);
  const [primeiraLista, segundaLista] = await Promise.all([primeiraTela, segundaTela]);

  assert.equal(primeiraLista, segundaLista);
  assert.deepEqual(primeiraLista.map(({ equipment_code }) => equipment_code), ["dala_a", "dala_b"]);
  assert.equal(state.equipmentsLoaded, true);
  assert.equal(state.equipmentsLoading, false);
  assert.equal(service.request, null);

  await service.loadAll({ force: true });
  assert.equal(chamadas, 2, "forçar atualização após concluir deve consultar novamente");
});

test("armazenamento transforma erro HTTP em erro classificado", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  const response = new Response(JSON.stringify({ error: "Conflito de operação." }), { status: 409 });

  await assert.rejects(
    armazenamento.jsonResponse(response, "Falha genérica."),
    (error) => error?.name === "ErroApi" && error.code === "HTTP_409" && error.message === "Conflito de operação.",
  );
});

test("armazenamento preserva mensagem alternativa do servidor sem consumir o erro antes", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  const response = new Response(JSON.stringify({ message: "Sessão inválida." }), { status: 401 });

  await assert.rejects(
    armazenamento.jsonResponse(response, "Falha genérica."),
    (error) => error?.name === "ErroApi" && error.code === "HTTP_401" && error.message === "Sessão inválida.",
  );
});

test("resposta atrasada de pendências não troca a página ou a Dala atual", async () => {
  const state = {
    loadingId: 7,
    pendingReadings: [],
    pendingReadingsPage: 1,
    pendingReadingsPages: 1,
    pendingReadingsTotal: 0,
    pendingReadingsLoadingId: 7,
  };
  let currentRequestId = 0;
  let finishOld;
  const oldResponse = new Promise((resolve) => { finishOld = resolve; });
  const service = new ServicoLeiturasOperacionais({
    state,
    api: {
    fetch: (path) => path.includes("page=2")
      ? oldResponse
      : Promise.resolve(new Response(JSON.stringify({
        data: [{ id: 11 }], pagination: { page: 1, pages: 1, total: 1 },
      }), { status: 200 })),
    },
    jsonHeaders: () => ({}),
    jsonResponse: (response) => response.json(),
    requestWithOfflineQueue: async () => {},
    nextPendingReadingsRequestId: () => ++currentRequestId,
    getPendingReadingsRequestId: () => currentRequestId,
    loadActiveLoading: async () => {},
    loadPendingReadings: async () => {},
  });
  const stale = service.loadPendingReadings(2);
  state.loadingId = 8;
  const fresh = service.loadPendingReadings();
  finishOld(new Response(JSON.stringify({
    data: [{ id: 99 }], pagination: { page: 2, pages: 2, total: 21 },
  }), { status: 200 }));
  await Promise.all([stale, fresh]);
  assert.deepEqual(state.pendingReadings, [{ id: 11 }]);
  assert.equal(state.pendingReadingsLoadingId, 8);
  assert.equal(state.pendingReadingsPage, 1);
});

test("falha na atualização posterior não transforma leitura confirmada em erro repetível", async () => {
  const state = { loadingId: 7 };
  let posts = 0;
  const service = new ServicoLeiturasOperacionais({
    state,
    api: {},
    jsonHeaders: () => ({}),
    jsonResponse: async (response) => response.json(),
    requestWithOfflineQueue: async (path, options, policy) => {
      assert.equal(path, "/api/leituras.php");
      assert.deepEqual(policy, { queueOffline: false, idempotent: true });
      assert.equal(options.headers["X-Trace-Offline-Id"], undefined);
      posts += 1;
      return new Response(JSON.stringify({ data: { id: 42, result: "VALIDO" } }), { status: 200 });
    },
    nextPendingReadingsRequestId: () => 1,
    getPendingReadingsRequestId: () => 1,
    loadActiveLoading: async () => { throw new Error("Consulta GET indisponível."); },
    loadPendingReadings: async () => assert.fail("não deve tentar recarregar pendências após a primeira falha"),
  });

  const result = await service.registerManualReading("7890123");

  assert.equal(result.id, 42);
  assert.equal(result.result, "VALIDO");
  assert.equal(result.refreshWarning, "Consulta GET indisponível.");
  assert.equal(posts, 1);
});

test("leitura USB confirmada recarrega a contagem do carregamento", async () => {
  const state = { loadingId: 7, loaded: 0 };
  const refreshed = [];
  const service = new ServicoLeiturasOperacionais({
    state,
    api: {},
    jsonHeaders: () => ({}),
    jsonResponse: async (response) => response.json(),
    requestWithOfflineQueue: async (path, _options, policy) => {
      assert.equal(path, "/api/leituras.php");
      assert.deepEqual(policy, { queueOffline: false, idempotent: true });
      return new Response(JSON.stringify({
        data: { id: 43, result: "VALIDO", load_status: "EM_ANDAMENTO" },
      }), { status: 200 });
    },
    nextPendingReadingsRequestId: () => 1,
    getPendingReadingsRequestId: () => 1,
    loadActiveLoading: async (loadingId) => {
      refreshed.push(["loading", loadingId]);
      state.loaded = 1;
    },
    loadPendingReadings: async () => { refreshed.push(["pending-readings"]); },
  });

  const result = await service.registerManualReading("7890123");

  assert.equal(result.result, "VALIDO");
  assert.equal(state.loaded, 1);
  assert.deepEqual(refreshed, [["loading", 7], ["pending-readings"]]);
});

test("identificação confirmada continua sucesso se a atualização da tela falhar", async () => {
  const state = { loadingId: 7 };
  let pendingReloaded = false;
  const service = new ServicoLeiturasOperacionais({
    state,
    api: {},
    jsonHeaders: () => ({}),
    jsonResponse: async (response) => response.json(),
    requestWithOfflineQueue: async (path) => {
      assert.equal(path, "/api/identificar_leitura.php");
      return new Response(JSON.stringify({
        data: { id: 91, result: "VALIDO", product_id: 12 },
      }), { status: 200 });
    },
    nextPendingReadingsRequestId: () => 1,
    getPendingReadingsRequestId: () => 1,
    loadActiveLoading: async () => { throw new Error("Consulta GET indisponível."); },
    loadPendingReadings: async () => { pendingReloaded = true; },
  });

  const result = await service.identifyReading(91, "7890123");

  assert.equal(result.result, "VALIDO");
  assert.equal(result.refreshWarning, "Consulta GET indisponível.");
  assert.equal(pendingReloaded, true);
});
