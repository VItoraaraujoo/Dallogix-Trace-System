const TAB_STORAGE_KEY = "trace-tab-id";

function obterIdAba() {
  try {
    const existente = String(sessionStorage.getItem(TAB_STORAGE_KEY) || "").toLowerCase();
    if (/^[a-f0-9]{32}$/.test(existente)) return existente;
    if (!globalThis.crypto?.getRandomValues) return "default";
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(TAB_STORAGE_KEY, id);
    return id;
  } catch (error) {
    return "default";
  }
}

export function configurarSessaoPorAba() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.__traceTabFetchConfigured === true) return;

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const inputUrl =
      typeof Request !== "undefined" && input instanceof Request
        ? input.url
        : String(input);
    let destination;
    try {
      destination = new URL(inputUrl, window.location.href);
    } catch (error) {
      return fetchOriginal(input, init);
    }
    if (destination.origin !== window.location.origin) {
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
    headers.set("X-Trace-Tab", obterIdAba());
    return fetchOriginal(input, { ...(init || {}), headers });
  };
  window.__traceTabFetchConfigured = true;
}
