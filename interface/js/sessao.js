const SESSION_STORAGE_KEY = "trace-session-token";

function obterTokenSessao() {
  try {
    return String(sessionStorage.getItem(SESSION_STORAGE_KEY) || "").trim();
  } catch (error) {
    return "";
  }
}

export function guardarTokenSessao(token) {
  const valor = String(token || "").trim();
  if (!valor) return false;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, valor);
    return true;
  } catch (error) {
    return false;
  }
}

export function limparTokenSessao() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    // O fluxo continua protegido pelo cookie quando o armazenamento não está disponível.
  }
}

export function configurarSessaoPorAba() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.__traceSessionFetchConfigured === true) return;

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const token = obterTokenSessao();
    if (!token) return fetchOriginal(input, init);

    const inputUrl =
      typeof Request !== "undefined" && input instanceof Request
        ? input.url
        : String(input);
    let destino;
    try {
      destino = new URL(inputUrl, window.location.href);
    } catch (error) {
      return fetchOriginal(input, init);
    }
    if (destino.origin !== window.location.origin) {
      return fetchOriginal(input, init);
    }

    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request
        ? input.headers
        : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }
    headers.set("X-Trace-Session", token);
    return fetchOriginal(input, { ...(init || {}), headers });
  };
  window.__traceSessionFetchConfigured = true;
}
