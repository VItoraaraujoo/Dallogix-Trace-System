/**
 * Transporte HTTP único do Trace.
 *
 * As telas continuam recebendo um Response nativo para preservar os contratos
 * existentes, mas toda requisição passa por timeout, cancelamento e retry
 * controlado. Escritas nunca são repetidas automaticamente.
 */
export class ErroApi extends Error {
  constructor(message, { code = "API_ERROR", status = 0, url = "", cause = null } = {}) {
    super(message);
    this.name = "ErroApi";
    this.code = code;
    this.status = Number(status) || 0;
    this.url = url;
    this.cause = cause;
  }
}

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRY_STATUS = new Set([408, 425, 429, 502, 503, 504]);

const MENSAGENS_HTTP = new Map([
  [400, "A requisição é inválida."],
  [401, "Sua sessão expirou. Entre novamente no sistema."],
  [403, "Você não tem permissão para esta operação."],
  [404, "O recurso solicitado não foi encontrado."],
  [409, "A operação entrou em conflito com o estado atual."],
  [422, "Os dados enviados não puderam ser validados."],
  [429, "Muitas tentativas. Aguarde alguns segundos e tente novamente."],
  [500, "O servidor encontrou um erro interno."],
  [502, "O servidor está temporariamente indisponível."],
  [503, "O servidor está temporariamente indisponível."],
  [504, "O servidor demorou para responder."],
]);

export function mensagemHttp(status, fallback = "Não foi possível concluir a requisição.") {
  return MENSAGENS_HTTP.get(Number(status)) || fallback;
}

/** Converte uma resposta inválida em ErroApi sem consumir o corpo original. */
export async function erroRespostaHttp(response, fallback = "Não foi possível concluir a requisição.") {
  if (response?.ok) return null;
  let detalhe = null;
  try {
    const fonte = typeof response?.clone === "function" ? response.clone() : response;
    detalhe = await fonte?.json?.();
  } catch (_) {
    detalhe = null;
  }
  const mensagem = detalhe?.error || detalhe?.message || fallback || mensagemHttp(response?.status);
  return new ErroApi(mensagem, {
    code: `HTTP_${Number(response?.status) || 0}`,
    status: Number(response?.status) || 0,
    url: response?.url || "",
  });
}

export async function exigirRespostaHttp(response, fallback) {
  const erro = await erroRespostaHttp(response, fallback);
  if (erro) throw erro;
  return response;
}

function atraso(ms) {
  const setTimeoutFn = globalThis.window?.setTimeout || globalThis.setTimeout;
  return new Promise((resolve) => setTimeoutFn(resolve, ms));
}

function mensagemDeErro(error, url) {
  if (error?.name === "AbortError") {
    return `A requisição demorou mais que o permitido (${url}).`;
  }
  if (globalThis.navigator?.onLine === false) {
    return "Sem conexão de rede para concluir a requisição.";
  }
  return error?.message || "Não foi possível comunicar com o servidor.";
}

function sinalComPrazo(signal, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  if (timeoutMs > 0) {
    const setTimeoutFn = globalThis.window?.setTimeout || globalThis.setTimeout;
    timer = setTimeoutFn(() => controller.abort(), timeoutMs);
  }
  return {
    signal: controller.signal,
    clear() {
      const clearTimeoutFn = globalThis.window?.clearTimeout || globalThis.clearTimeout;
      if (timer) clearTimeoutFn(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

export class ClienteApi {
  constructor({ timeoutMs = 15000, retry = 2, backoffMs = 400 } = {}) {
    this.timeoutMs = timeoutMs;
    this.retry = retry;
    this.backoffMs = backoffMs;
  }

  async fetch(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const canRetry = METODOS_SEGUROS.has(method);
    const attempts = canRetry ? Math.max(0, Number(options.retry ?? this.retry)) : 0;
    const timeoutMs = Number(options.timeoutMs ?? this.timeoutMs);
    const { timeoutMs: _timeout, retry: _retry, ...requestOptions } = options;

    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      const request = sinalComPrazo(requestOptions.signal, timeoutMs);
      try {
        const response = await fetch(url, { ...requestOptions, signal: request.signal });
        if (response.ok || !canRetry || !RETRY_STATUS.has(response.status) || attempt >= attempts) {
          return response;
        }
      } catch (error) {
        if (attempt >= attempts) {
          const cancelledByCaller = requestOptions.signal?.aborted === true;
          throw new ErroApi(
            cancelledByCaller ? "A requisição foi cancelada." : mensagemDeErro(error, url),
            {
            code: cancelledByCaller
              ? "API_CANCELLED"
              : error?.name === "AbortError"
                ? "API_TIMEOUT"
                : "API_NETWORK",
            url,
            cause: error,
            },
          );
        }
      } finally {
        request.clear();
      }
      await atraso(this.backoffMs * (2 ** attempt));
    }

    throw new ErroApi("A requisição não pôde ser concluída.", { url });
  }
}
