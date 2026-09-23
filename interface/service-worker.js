const CACHE_NAME = "trace-shell-20260922-42";
const SHELL = [
  "/",
  "/index.html",
  "/dashboard.html",
  "/manifests.html",
  "/manifest.html",
  "/manifest-edit.html",
  "/import.html",
  "/division.html",
  "/work.html",
  "/summary.html",
  "/occurrences.html",
  "/products.html",
  "/dalas.html",
  "/dala.html",
  "/dala-edit.html",
  "/dala-actions.html",
  "/settings.html",
  "/alerts.html",
  "/emergency.html",
  "/css/styles.css",
  "/css/light-theme.css",
  "/css/dalas-screen.css",
  "/css/auth.css",
  "/css/responsive.css",
  "/js/login.js",
  "/js/sessao.js",
  "/js/aplicacao.js",
  "/js/classes/ArmazenamentoTrace.js",
  "/js/classes/OfflineOperationBuffer.js",
  "/js/constantes/acoes.js",
  "/js/controladores/operacao.js",
  "/js/controladores/tempo-real.js",
  "/js/funcoes/formato.js",
  "/js/funcoes/relogio.js",
  "/js/funcoes/html.js",
  "/js/funcoes/rotulos.js",
  "/js/funcoes/view.js",
  "/js/telas/configuracoes.js",
  "/js/telas/dalas.js",
  "/js/telas/empresa.js",
  "/js/telas/empresas.js",
  "/js/telas/logs.js",
  "/js/telas/master.js",
  "/js/telas/monitoramento.js",
  "/js/telas/operacoes.js",
  "/js/telas/painel.js",
  "/js/telas/usuarios.js",
];

async function cacheResponse(request, response) {
  if (!response || !response.ok || response.type === "opaque") return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        SHELL.map(async (path) => {
          try {
            await cache.add(new Request(path, { cache: "reload" }));
          } catch (_) {
            // A instalação não pode falhar se uma tela opcional não estiver disponível.
          }
        }),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (names) => {
      await Promise.all(
        names
          .filter((name) => name.startsWith("trace-shell-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(new Request(request, { cache: "no-store" }))
        .then((response) => cacheResponse(request, response))
        .catch(async () => (await caches.match(request, { ignoreSearch: true })) || caches.match("/index.html")),
    );
    return;
  }

  if (/\.(?:css|js)$/.test(url.pathname)) {
    event.respondWith(
      fetch(new Request(request, { cache: "no-store" }))
        .then((response) => cacheResponse(request, response))
        .catch(async () => (await caches.match(request, { ignoreSearch: true })) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const refresh = fetch(request)
        .then((response) => cacheResponse(request, response))
        .catch(() => cached);
      return cached || refresh;
    }),
  );
});
