import assert from "node:assert/strict";
import test from "node:test";
import { ServicoSincronizacao } from "../interface/js/servicos/ServicoSincronizacao.js";

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return data; } };
}

test("consulta monitoramento e registra instante da resposta", async () => {
  const api = { async fetch(url) { assert.equal(url, "/api/monitoramento.php"); return response({ data: { dispositivos: [] } }); } };
  const service = new ServicoSincronizacao({ api, offlineBuffer: { flush: async () => ({ pending: 0 }) } });
  const result = await service.monitoramento();
  assert.deepEqual(result.data, { dispositivos: [] });
  assert.match(result.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("não esconde erro da fila de sincronização", async () => {
  const api = { async fetch() { return response({ error: "fila indisponível" }, { ok: false, status: 503 }); } };
  const service = new ServicoSincronizacao({ api, offlineBuffer: { flush: async () => ({ pending: 0 }) } });
  await assert.rejects(service.statusFila(), /fila indisponível/);
});

test("reprocessa evento e preserva headers de sessão", async () => {
  let request;
  const api = { async fetch(url, options) { request = { url, options }; return response({ data: { id: 12 } }, { status: 202 }); } };
  const service = new ServicoSincronizacao({ api, offlineBuffer: { flush: async () => ({ pending: 0 }) } });
  const result = await service.reprocessarEvento(12, { "X-CSRF-Token": "token" });
  assert.deepEqual(result, { id: 12 });
  assert.equal(request.url, "/api/sync_queue.php");
  assert.equal(request.options.headers["X-CSRF-Token"], "token");
  assert.deepEqual(JSON.parse(request.options.body), { id: 12 });
});

test("envia pendências para a fila offline sem duplicar regras", async () => {
  let received;
  const buffer = { async flush(headers) { received = headers; return { sent: 2, pending: 1 }; } };
  const service = new ServicoSincronizacao({ api: { fetch: async () => response({}) }, offlineBuffer: buffer });
  const result = await service.enviarPendencias({ "X-CSRF-Token": "token" });
  assert.deepEqual(result, { sent: 2, pending: 1 });
  assert.deepEqual(received, { "X-CSRF-Token": "token" });
});
