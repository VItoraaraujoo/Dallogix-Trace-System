import assert from "node:assert/strict";
import { test } from "node:test";
import { ClienteApi, ErroApi } from "../interface/js/api/ClienteApi.js";

const resposta = (status = 200, body = "{}") => new Response(body, {
  status,
  headers: { "content-type": "application/json" },
});

test("repete uma leitura segura após falha de rede e retorna a resposta", async () => {
  const originalFetch = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => {
    chamadas += 1;
    if (chamadas === 1) throw new TypeError("rede indisponível");
    return resposta(200, '{"ok":true}');
  };
  try {
    const response = await new ClienteApi({ retry: 1, backoffMs: 0 }).fetch("/api/health.php");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(chamadas, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("não repete escrita após falha de rede", async () => {
  const originalFetch = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => {
    chamadas += 1;
    throw new TypeError("rede indisponível");
  };
  try {
    await assert.rejects(
      new ClienteApi({ retry: 3, backoffMs: 0 }).fetch("/api/comando.php", { method: "POST" }),
      (error) => error instanceof ErroApi && error.code === "API_NETWORK",
    );
    assert.equal(chamadas, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repete respostas temporárias e preserva a resposta final", async () => {
  const originalFetch = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => {
    chamadas += 1;
    return chamadas === 1 ? resposta(503) : resposta(200, '{"status":"ok"}');
  };
  try {
    const response = await new ClienteApi({ retry: 1, backoffMs: 0 }).fetch("/api/status.php");
    assert.equal(response.status, 200);
    assert.equal(chamadas, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("converte timeout em erro de API sem deixar requisição pendente", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  try {
    await assert.rejects(
      new ClienteApi({ retry: 0, timeoutMs: 5 }).fetch("/api/lenta.php"),
      (error) => error instanceof ErroApi && error.code === "API_TIMEOUT",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserva cancelamento explícito do chamador como cancelamento", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("cancelled");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
    controller.abort();
  });
  try {
    await assert.rejects(
      new ClienteApi({ retry: 0, timeoutMs: 1000 }).fetch("/api/cancelada.php", { signal: controller.signal }),
      (error) => error instanceof ErroApi && error.code === "API_CANCELLED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
