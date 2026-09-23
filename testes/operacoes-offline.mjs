import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const bufferSource = readFileSync(new URL("../interface/js/classes/OfflineOperationBuffer.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/, "const agora = () => new Date();\n");
const { OfflineOperationBuffer } = await import(`data:text/javascript;base64,${Buffer.from(bufferSource).toString("base64")}`);

test("a fila pertence ao usuário e não descarta falhas HTTP", async () => {
  const buffer = new OfflineOperationBuffer();
  buffer.setOwner({ id: 1, company_id: 10 });
  const id = await buffer.enqueue({ eventId: "11111111-1111-4111-8111-111111111111", url: "/api/retornos.php", method: "POST", body: "{}", headers: { "X-CSRF-Token": "antigo" } });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => { calls.push(options); return { ok: false, status: 422 }; };
  try {
    assert.equal((await buffer.flush({ "X-CSRF-Token": "atual" })).pending, 1);
    assert.equal(calls[0].headers["X-CSRF-Token"], "atual");
    assert.equal(calls[0].headers["X-Trace-Offline-Id"], "11111111-1111-4111-8111-111111111111");
    buffer.setOwner({ id: 2, company_id: 10 });
    assert.equal((await buffer.all()).length, 0);
    assert.equal((await buffer.flush()).sent, 0);
    buffer.setOwner({ id: 1, company_id: 10 });
    assert.equal((await buffer.all())[0].id, id);
    assert.equal((await buffer.all())[0].headers["X-CSRF-Token"], undefined);
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    assert.deepEqual(await buffer.flush({ "X-CSRF-Token": "atual" }), { sent: 1, pending: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uma resposta perdida conserva o mesmo identificador no envio original e no retry", async () => {
  globalThis.__TraceOfflineOperationBuffer = OfflineOperationBuffer;
  const storeSource = readFileSync(new URL("../interface/js/classes/ArmazenamentoTrace.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/, "const OfflineOperationBuffer = globalThis.__TraceOfflineOperationBuffer;\n");
  const { ArmazenamentoTrace } = await import(`data:text/javascript;base64,${Buffer.from(storeSource).toString("base64")}`);
  const store = new ArmazenamentoTrace();
  store.setUser({ id: 3, company_id: 7, role: "USUARIO" });
  store.setCsrfToken("atual");
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, options) => { seen.push(options.headers["X-Trace-Offline-Id"]); if (seen.length === 1) throw new Error("resposta perdida"); return { ok: true }; };
  try {
    const response = await store.requestWithOfflineQueue("/api/retornos.php", { method: "POST", headers: store.jsonHeaders(), body: "{}" });
    assert.equal(response.status, 202);
    assert.equal((await store.flushOfflineOperations()).pending, 0);
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1]);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__TraceOfflineOperationBuffer;
  }
});
