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
  let quantidadePendente;
  const buffer = { async flush(headers) { received = headers; return { sent: 2, pending: 1 }; } };
  const service = new ServicoSincronizacao({
    api: { fetch: async () => response({}) },
    offlineBuffer: buffer,
    onOfflineQueueChanged: (count) => { quantidadePendente = count; },
  });
  const result = await service.enviarPendencias({ "X-CSRF-Token": "token" });
  assert.deepEqual(result, { sent: 2, pending: 1 });
  assert.deepEqual(received, { "X-CSRF-Token": "token" });
  assert.equal(quantidadePendente, 1);
});

test("requisição operacional queueable preserva idempotência e atualiza a contagem", async () => {
  const chamadas = [];
  let operacaoEnfileirada;
  let quantidadePendente;
  const offlineBuffer = {
    async enqueue(operation) { operacaoEnfileirada = operation; return 42; },
    async all() { return [{ id: 42 }]; },
    async flush() { return { pending: 0 }; },
  };
  const api = {
    async fetch(url, options) {
      chamadas.push({ url, options });
      throw new Error("rede indisponível");
    },
  };
  const service = new ServicoSincronizacao({
    api,
    offlineBuffer,
    createEventId: () => "event-id-42",
    onOfflineQueueChanged: (count) => { quantidadePendente = count; },
  });

  const requestOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf" },
    body: JSON.stringify({ carregamento_id: 12, barcode: "789" }),
  };
  const queuedResponse = await service.requestWithOfflineQueue("/api/leituras.php", requestOptions);
  const payload = await queuedResponse.json();

  assert.equal(service.canQueueOffline("/api/leituras.php", requestOptions), true);
  assert.equal(queuedResponse.status, 202);
  assert.deepEqual(payload.data, { queued: true, offline_id: 42 });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].options.headers["X-Trace-Offline-Id"], "event-id-42");
  assert.equal(operacaoEnfileirada.eventId, chamadas[0].options.headers["X-Trace-Offline-Id"]);
  assert.deepEqual(operacaoEnfileirada.headers, requestOptions.headers);
  assert.equal(operacaoEnfileirada.body, requestOptions.body);
  assert.equal(quantidadePendente, 1);
});

test("fila offline não intercepta consultas nem endpoints fora da lista permitida", async () => {
  const service = new ServicoSincronizacao({
    api: { async fetch() { throw new Error("offline"); } },
    offlineBuffer: { async flush() { return { pending: 0 }; } },
    createEventId: () => "event-id-43",
  });
  assert.equal(service.canQueueOffline("/api/leituras.php", { method: "GET" }), false);
  assert.equal(service.canQueueOffline("/api/health.php", { method: "POST", body: "{}" }), false);
  assert.equal(service.canQueueOffline("/api/retornos.php", { method: "POST", body: {} }), false);
  await assert.rejects(
    service.requestWithOfflineQueue("/api/health.php", { method: "POST", body: "{}" }),
    /offline/,
  );
});

test("processa evento SSE dividido em quadros e no fim do stream", async () => {
  let entregue;
  let liberar;
  const finalizado = new Promise((resolve) => { liberar = resolve; });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: carregamento\ndata: {"id":'));
      controller.enqueue(new TextEncoder().encode('7}\n'));
      controller.close();
    },
  });
  const api = { async fetch() { return { ok: true, body: stream }; } };
  const service = new ServicoSincronizacao({ api, offlineBuffer: { flush: async () => ({}) } });
  service.assinarEventos({ onData(data) { entregue = data; liberar(); } });
  await Promise.race([finalizado, new Promise((_, reject) => setTimeout(() => reject(new Error("evento não recebido")), 500))]);
  assert.deepEqual(entregue, { id: 7 });
});

test("encerra stream SSE que ultrapassa o limite sem acumular memória", async () => {
  let recebido;
  let liberar;
  const finalizado = new Promise((resolve) => { liberar = resolve; });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: carregamento\ndata: ${"x".repeat(130 * 1024)}\n`));
      controller.close();
    },
  });
  const api = { async fetch() { return { ok: true, body: stream }; } };
  const service = new ServicoSincronizacao({ api, offlineBuffer: { flush: async () => ({}) } });
  service.assinarEventos({ onError(error) { recebido = error; liberar(); } });
  await Promise.race([finalizado, new Promise((_, reject) => setTimeout(() => reject(new Error("erro não recebido")), 500))]);
  assert.match(recebido?.message || "", /limite permitido/);
});
