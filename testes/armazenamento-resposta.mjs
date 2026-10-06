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
