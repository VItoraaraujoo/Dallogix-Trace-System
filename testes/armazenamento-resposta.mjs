import assert from "node:assert/strict";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

test("armazenamento preserva resposta válida como dados", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  const response = new Response(JSON.stringify({ data: { total: 3 } }), { status: 200 });

  await assert.deepEqual(
    await armazenamento.jsonResponse(response, "fallback"),
    { data: { total: 3 } },
  );
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
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = {
    loadingId: 7,
    pendingReadings: [],
    pendingReadingsPage: 1,
    pendingReadingsPages: 1,
    pendingReadingsTotal: 0,
    pendingReadingsLoadingId: 7,
  };
  armazenamento.pendingReadingsRequestId = 0;
  let finishOld;
  const oldResponse = new Promise((resolve) => { finishOld = resolve; });
  armazenamento.api = {
    fetch: (path) => path.includes("page=2")
      ? oldResponse
      : Promise.resolve(new Response(JSON.stringify({
        data: [{ id: 11 }], pagination: { page: 1, pages: 1, total: 1 },
      }), { status: 200 })),
  };
  const stale = armazenamento.loadPendingReadings(2);
  armazenamento.state.loadingId = 8;
  const fresh = armazenamento.loadPendingReadings();
  finishOld(new Response(JSON.stringify({
    data: [{ id: 99 }], pagination: { page: 2, pages: 2, total: 21 },
  }), { status: 200 }));
  await Promise.all([stale, fresh]);
  assert.deepEqual(armazenamento.state.pendingReadings, [{ id: 11 }]);
  assert.equal(armazenamento.state.pendingReadingsLoadingId, 8);
  assert.equal(armazenamento.state.pendingReadingsPage, 1);
});
