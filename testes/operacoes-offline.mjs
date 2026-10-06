import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const clientSource = readFileSync(new URL("../interface/js/api/ClienteApi.js", import.meta.url), "utf8");
const clientModuleUrl = `data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`;
const bufferSource = readFileSync(new URL("../interface/js/classes/OfflineOperationBuffer.js", import.meta.url), "utf8")
  .replace(/^import .*relogio\.js[^;]*;\n/, "const agora = () => new Date();\n")
  .replace(/^import .*ClienteApi\.js[^;]*;\n/m, `import { ClienteApi } from ${JSON.stringify(clientModuleUrl)};\n`);
const bufferModuleUrl = `data:text/javascript;base64,${Buffer.from(bufferSource).toString("base64")}`;
const { OfflineOperationBuffer, secureRandomId } = await import(bufferModuleUrl);
const loggerSource = readFileSync(new URL("../interface/js/utilitarios/LogFrontend.js", import.meta.url), "utf8");
const syncSource = readFileSync(new URL("../interface/js/servicos/ServicoSincronizacao.js", import.meta.url), "utf8")
  .replace(/^import .*ClienteApi\.js[^;]*;\n/m, `import { exigirRespostaHttp } from ${JSON.stringify(clientModuleUrl)};\n`)
  // O serviço é carregado como data: para isolar o armazenamento. Incluir o
  // logger nessa mesma unidade mantém o teste fiel sem depender de uma URL
  // relativa que o Node não consegue resolver a partir de data:.
  .replace(/^import .*LogFrontend\.js[^;]*;\n/m, `${loggerSource}\n`);
const syncModuleUrl = `data:text/javascript;base64,${Buffer.from(syncSource).toString("base64")}`;
const storeSource = readFileSync(new URL("../interface/js/classes/ArmazenamentoTrace.js", import.meta.url), "utf8")
  .replace(/"\.\/OfflineOperationBuffer\.js\?v=[^"]+"/, JSON.stringify(bufferModuleUrl))
  .replace(/"\.\.\/api\/ClienteApi\.js\?v=[^"]+"/, JSON.stringify(clientModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoSincronizacao\.js\?v=[^"]+"/, JSON.stringify(syncModuleUrl));
const { ArmazenamentoTrace } = await import(`data:text/javascript;base64,${Buffer.from(storeSource).toString("base64")}`);

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
  }
});

test("o fallback usa bytes criptográficos quando randomUUID não existe", () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  let calls = 0;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
    getRandomValues(bytes) {
      calls += 1;
      assert.equal(bytes.length, 16);
      return bytes.fill(0xab);
    },
  } });
  try {
    assert.equal(secureRandomId(), "ab".repeat(16));
    assert.equal(calls, 1);
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
    else delete globalThis.crypto;
  }
});

test("sem criptografia, consultas funcionam e gravações offline são bloqueadas antes do envio", async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const originalFetch = globalThis.fetch;
  const calls = [];
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true }; };
  try {
    assert.throws(() => secureRandomId(), /Geração segura de identificadores indisponível/);
    const store = new ArmazenamentoTrace();
    assert.equal((await store.requestWithOfflineQueue("/api/health.php")).ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers?.["X-Trace-Offline-Id"], undefined);
    await assert.rejects(store.requestWithOfflineQueue("/api/retornos.php", {
      method: "POST", body: "{}",
    }), /Geração segura de identificadores indisponível/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
    else delete globalThis.crypto;
  }
});
