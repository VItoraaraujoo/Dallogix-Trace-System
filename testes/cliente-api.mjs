import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ClienteApi,
  ErroApi,
  exigirRespostaHttp,
  mensagemHttp,
  registrarAtividadeDeUsuario,
} from "../interface/js/api/ClienteApi.js";

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

test("cancela consultas GET da tela anterior quando começa uma nova navegação", async () => {
  const originalFetch = globalThis.fetch;
  const api = new ClienteApi({ retry: 3, backoffMs: 0, timeoutMs: 1000 });
  let cancelamentos = 0;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      cancelamentos += 1;
      const error = new Error("navegação mudou");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  try {
    api.beginNavigation();
    const consulta = api.fetch("/api/dados-da-tela.php");
    api.beginNavigation();
    await assert.rejects(
      consulta,
      (error) => error instanceof ErroApi && error.code === "API_CANCELLED",
    );
    assert.equal(cancelamentos, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("padroniza mensagens e códigos dos erros HTTP", async () => {
  assert.equal(mensagemHttp(401), "Sua sessão expirou. Entre novamente no sistema.");
  await assert.rejects(
    exigirRespostaHttp(resposta(422, JSON.stringify({ error: "Código inválido." }))),
    (error) => error instanceof ErroApi && error.code === "HTTP_422" && error.status === 422 && error.message === "Código inválido.",
  );
});

test("encaminha 401 de telas protegidas para o fluxo de sessão expirada", async () => {
  const originalFetch = globalThis.fetch;
  let unauthorized = null;
  globalThis.fetch = async () => resposta(401, JSON.stringify({ error: "Sessão expirada." }));
  try {
    const api = new ClienteApi({
      retry: 0,
      onUnauthorized: (response, url) => { unauthorized = { status: response.status, url }; },
    });
    const response = await api.fetch("/api/monitoramento.php");
    assert.equal(response.status, 401);
    assert.deepEqual(unauthorized, { status: 401, url: "/api/monitoramento.php" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falha de credencial no formulário de login não dispara redirecionamento de sessão", async () => {
  const originalFetch = globalThis.fetch;
  let unauthorizedCalls = 0;
  globalThis.fetch = async () => resposta(401, JSON.stringify({ error: "Senha inválida." }));
  try {
    const api = new ClienteApi({ retry: 0, onUnauthorized: () => { unauthorizedCalls += 1; } });
    const response = await api.fetch("/api/login.php");
    assert.equal(response.status, 401);
    assert.equal(unauthorizedCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("consulta de autenticação inicial mantém o tratamento próprio de acesso", async () => {
  const originalFetch = globalThis.fetch;
  let unauthorizedCalls = 0;
  globalThis.fetch = async () => resposta(401, JSON.stringify({ error: "Autenticação necessária." }));
  try {
    const api = new ClienteApi({ retry: 0, onUnauthorized: () => { unauthorizedCalls += 1; } });
    const response = await api.fetch("/api/me.php");
    assert.equal(response.status, 401);
    assert.equal(unauthorizedCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserva o corpo para a tela depois de classificar um erro HTTP", async () => {
  const response = resposta(503, JSON.stringify({ error: "Fila indisponível." }));
  await assert.rejects(exigirRespostaHttp(response), /Fila indisponível/);
  assert.deepEqual(await response.json(), { error: "Fila indisponível." });
});

test("marca requisições próximas a uma interação real para renovar a sessão", async () => {
  const originalFetch = globalThis.fetch;
  let headers;
  globalThis.fetch = async (_url, options) => {
    headers = new Headers(options.headers);
    return resposta();
  };
  try {
    registrarAtividadeDeUsuario();
    await new ClienteApi({ retry: 0 }).fetch("/api/monitoramento.php");
    assert.equal(headers.get("X-Trace-User-Activity"), "1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
