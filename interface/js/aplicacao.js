import {
  configurarSessaoPorAba,
} from "./sessao.js?v=202609222100";
import { ClienteApi } from "./api/ClienteApi.js?v=202610060001";
import { confirmarAcao, notificar, solicitarTexto } from "./componentes/notificacoes.js?v=202610061820";
import { ServicoEmergencia } from "./servicos/ServicoEmergencia.js?v=202610060001";
import { ServicoOperacao } from "./servicos/ServicoOperacao.js?v=202610060001";
import { ArmazenamentoTrace } from "./classes/ArmazenamentoTrace.js?v=202610070203";
import { FORM_ACTIONS } from "./constantes/acoes.js?v=202609140210";
import { atualizarStatusDasDalas, linhaItemRomaneio } from "./controladores/operacao.js";
import { createOperationalRealtimeController } from "./controladores/tempo-real.js?v=202610070203";
import { createSettingsStatusController } from "./controladores/status-configuracoes.js?v=202610070203";
import { createMachineCommandQueue } from "./controladores/comandos-maquina.js?v=202610070203";
import { numero, relativo } from "./funcoes/formato.js?v=202609201000";
import { el, esc } from "./funcoes/html.js";
import { agora, sincronizarRelogio, statusRelogio, usarRelogioDoPc } from "./funcoes/relogio.js?v=202609170015";
import { rotuloEstado } from "./funcoes/rotulos.js?v=202609240001";
import { apresentacaoStatusDispositivo, settings } from "../telas/configuracoes/configuracoes.js?v=202610070203";
import { dalas } from "../telas/dalas/dalas.js?v=202610010001";
import { dalaEdit } from "../telas/editar-dala/editar-dala.js?v=202610010001";
import { dalaView } from "../telas/visualizar-dala/visualizar-dala.js?v=202610010001";
import { company } from "../telas/empresa/empresa.js?v=202610020006";
import { companies } from "../telas/empresas/empresas.js?v=202610010001";
import { errorLogs } from "../telas/logs-erros/logs-erros.js?v=202610010001";
import { masterHome } from "../telas/painel-dallogix/painel-dallogix.js?v=202610010001";
import { alerts } from "../telas/alertas/alertas.js?v=202610010001";
import { emergency } from "../telas/emergencia/emergencia.js?v=202610010001";
import { occurrences } from "../telas/ocorrencias/ocorrencias.js?v=202610010001";
import { products } from "../telas/produtos/produtos.js?v=202610010001";
import { summary } from "../telas/resumo-final/resumo-final.js?v=202610010001";
import { division } from "../telas/divisao-carga/divisao-carga.js?v=202610010001";
import { importScreen } from "../telas/importar-romaneio/importar-romaneio.js?v=202610010001";
import { manifestEdit } from "../telas/editar-romaneio/editar-romaneio.js?v=202610010001";
import { manifests } from "../telas/romaneios/romaneios.js?v=202610010001";
import { manifestView } from "../telas/romaneio/romaneio.js?v=202610010001";
import { work } from "../telas/operacao/operacao.js?v=202610070203";
import { dashboard } from "../telas/painel/painel.js?v=202610010001";
import { users } from "../telas/usuarios/usuarios.js?v=202610010001";
import { validarDala, validarProduto } from "./utilitarios/Validadores.js?v=202610060003";
import { logFrontend } from "./utilitarios/LogFrontend.js?v=202610060006";
import { estadoErro } from "./componentes/estados.js?v=202610060002";
import {
  LEGACY_PAGE_IDS,
  NAV_GROUPS,
  PAGE_IDS_BY_PATH,
  PAGE_LABELS,
  PAGE_PATHS,
  ROLE_LABELS,
  ROLE_PAGES,
} from "./configuracaoAplicacao.js?v=202610060005";

configurarSessaoPorAba();

const store = new ArmazenamentoTrace();
const api = new ClienteApi();
const servicoEmergencia = new ServicoEmergencia(store);
const servicoOperacao = new ServicoOperacao(store);
let renderRequestId = 0;
let workViewSignature = "";
const screens = {
  dashboard,
  manifests,
  import: importScreen,
  division,
  work,
  occurrences,
  summary,
  products,
  alerts,
  emergency,
  settings,
  dalas,
  dala: dalaView,
  "dala-edit": dalaEdit,
  manifest: manifestView,
  "manifest-edit": manifestEdit,
  companies,
  "master-home": masterHome,
  company,
  users,
  "error-logs": errorLogs,
};
// Os arquivos HTML continuam acessíveis diretamente, mas, após o primeiro carregamento,
// as mudanças de tela usam o History API para não reiniciar toda a aplicação.
const initialPage =
  document.querySelector("script[data-page]")?.dataset.page || "";
let currentPage = initialPage;
let authenticatedUser = null;
let localHealthTimer = null;
let localHealthRequest = false;

// A tela de operação comunica o estado diretamente pelos cartões e botões.
// Notificações flutuantes nessa tela cobrem os comandos e repetem informações
// que já aparecem no estado atualizado do carregamento.
function notificarForaDaOperacao(mensagem, tipo = "informacao") {
  if (currentPage === "work") return;
  notificar(mensagem, tipo);
}

const machineCommandQueue = createMachineCommandQueue({
  onDrained: (loadingId) => {
    // Faz uma única leitura autoritativa depois que os cliques enfileirados
    // forem enviados; leituras intermediárias poderiam devolver estado antigo.
    if (currentPage === "work") {
      Promise.allSettled([
        store.loadActiveLoading(loadingId),
        store.loadMonitoring(),
      ]).then(() => {
        if (currentPage === "work") render();
      });
    }
  },
});

async function executarComandoDeOperacao(node, action) {
  const loadingId = Number(node.dataset.loadingId || store.state.loadingId) || null;
  const commands = {
    "start-machine": "INICIAR_CARREGAMENTO",
    run: "INICIAR_CARREGAMENTO",
    "stop-machine": "PAUSAR_CARREGAMENTO",
    stop: "PAUSAR_CARREGAMENTO",
    "reverse-machine": "REVERSAO_ATIVAR",
    "reverse-on": "REVERSAO_ATIVAR",
    "reverse-off": "REVERSAO_DESATIVAR",
    emergency: "EMERGENCIA",
  };
  const command = action === "reverse-toggle"
    ? (store.state.returnMode ? "REVERSAO_DESATIVAR" : "REVERSAO_ATIVAR")
    : commands[action];
  try {
    await machineCommandQueue.enqueue(loadingId, command, async () => {
      if (command === "INICIAR_CARREGAMENTO") return servicoOperacao.iniciar(loadingId);
      if (command === "PAUSAR_CARREGAMENTO") return servicoOperacao.parar(loadingId);
      if (command === "REVERSAO_ATIVAR") return servicoOperacao.reversao(true, loadingId);
      if (command === "REVERSAO_DESATIVAR") return servicoOperacao.reversao(false, loadingId);
      if (command === "EMERGENCIA") return store.requestMachineEmergency(loadingId);
      throw new Error("Comando operacional inválido.");
    });
    if (currentPage === "work") render();
  } catch (error) {
    notificarForaDaOperacao(error.message, "erro");
    if (currentPage === "work") render();
  }
}

const workRealtime = createOperationalRealtimeController({
  store,
  getPage: () => currentPage,
  render: () => render(),
  refreshWorkLiveView: () => refreshWorkLiveView(),
  workStructureSignature: () => workStructureSignature(),
  getViewSignature: () => workViewSignature,
});
const settingsRealtime = createSettingsStatusController({
  store,
  getPage: () => currentPage,
  refreshView: () => refreshSettingsStatusView(),
});

function sidebarCollapsed() {
  try {
    return localStorage.getItem("trace-sidebar-collapsed") === "1";
  } catch (error) {
    return false;
  }
}
function normalizeRole(role) {
  return typeof role === "string" ? role.toUpperCase() : "";
}
function allowedPages() {
  return ROLE_PAGES[normalizeRole(authenticatedUser?.role)] || [];
}
function defaultPage() {
  const normalizedRole = normalizeRole(authenticatedUser?.role);
  if (normalizedRole === "ADMIN_DALLOGIX") return "master-home";
  const permittedPages = allowedPages();
  return permittedPages.includes("dashboard") ? "dashboard" : permittedPages[0] || "manifests";
}
function isAllowedPage(page) {
  return typeof page === "string" && allowedPages().includes(page);
}
function resolveAuthorizedPage(page, fallbackPage = defaultPage()) {
  if (typeof page !== "string" || !isAllowedPage(page)) return fallbackPage;
  return page;
}
function pagePath(page, query = "") {
  return `${PAGE_PATHS[page] || PAGE_PATHS.login}${query}`;
}
function pageFromPath(pathname = window.location.pathname) {
  if (PAGE_IDS_BY_PATH[pathname]) return PAGE_IDS_BY_PATH[pathname];
  const file = pathname.split("/").pop() || "index.html";
  return LEGACY_PAGE_IDS[file] || file.replace(/\.html$/, "");
}
async function navigate(page, query = "", { replace = false } = {}) {
  const safePage = resolveAuthorizedPage(page, defaultPage());
  page = safePage;
  if (!screens[page]) {
    page = defaultPage();
    query = "";
  }
  const path = pagePath(page, query);
  if (currentPage === page && window.location.search === query) return;
  currentPage = page;
  if (replace) window.history.replaceState({ page }, "", path);
  else window.history.pushState({ page }, "", path);
  await renderPage();
  window.scrollTo({ top: 0, behavior: "auto" });
}
function queryId() {
  return new URLSearchParams(window.location.search).get("id");
}
function isDashboardReturn() {
  return new URLSearchParams(window.location.search).get("from") === "dashboard";
}
function dashboardReturnQuery() {
  return isDashboardReturn() ? "?from=dashboard" : "";
}
function queryReturnPage() {
  const page = new URLSearchParams(window.location.search).get("from");
  return ["dashboard", "dalas", "master-home", "companies"].includes(page || "")
    ? page
    : "dalas";
}

function navigationIcon(page) {
  const icons = {
    manifests:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4.5h6M9 10h6M9 14h4"/></svg>',
    dashboard:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
    products:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9"/></svg>',
    dalas:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h10v9H3zM13 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55v.1h-3v-.1A1.7 1.7 0 0 0 10.7 18.6a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 15a1.7 1.7 0 0 0-1.55-1.03h-.1v-3h.1A1.7 1.7 0 0 0 7.06 9.94 1.7 1.7 0 0 0 6.72 8.06L6.66 8l2.1-2.1.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.55v-.1h3v.1A1.7 1.7 0 0 0 15.76 6.3a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.55 1.03h.1v3h-.1A1.7 1.7 0 0 0 19.4 15Z"/></svg>',
    work: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18v8H3zM7 8V5h10v3M7 16v3h10v-3"/><path d="M8 12h8"/></svg>',
    occurrences:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/></svg>',
    summary:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    alerts:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
    companies:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5l8-3 8 3v16M4 10h16M8 7h.01M12 7h.01M16 7h.01M8 14h.01M12 14h.01M16 14h.01"/></svg>',
    "master-home":
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V5h16v15M8 9h8M8 13h4M8 17h8"/><path d="M16 13h3v4h-3z"/></svg>',
    users:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c.7-4 10.3-4 12 0M15 15c3.2-.4 5.3 1.1 6 3.2"/></svg>',
  };
  return icons[page] || icons.dashboard;
}

let currentInstallationMode = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
  ? "local"
  : "central";

function setLocalIndicator(state, checkedAt = null, installationMode = currentInstallationMode) {
  const labels = installationMode === "central"
    ? {
        online: "Servidor central online",
        degraded: "Servidor central sem confirmação",
        offline: "Servidor central sem comunicação",
      }
    : {
        online: "Sistema local online",
        degraded: "Sistema local sem confirmação",
        offline: "Sistema local sem comunicação",
      };
  const clock = statusRelogio();
  const detail = checkedAt
    ? `Última verificação: ${new Date(checkedAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })} • Horário: ${clock.label}`
    : `Horário: ${clock.label}`;
  document.querySelectorAll(".local").forEach((indicator) => {
    indicator.classList.remove("is-online", "is-degraded", "is-offline");
    indicator.classList.add(`is-${state}`);
    indicator.innerHTML = `<i></i> ${labels[state] || labels.degraded}`;
    indicator.title = detail;
    indicator.setAttribute("aria-label", `${labels[state] || labels.degraded}. ${detail}`);
  });
}

async function refreshLocalIndicator() {
  if (localHealthRequest) return;
  if (!navigator.onLine) {
    usarRelogioDoPc();
    store.state.serverStatus = "OFFLINE";
    setLocalIndicator("offline");
    if (currentPage === "work") refreshWorkLiveView();
    if (currentPage === "settings") refreshSettingsStatusView();
    return;
  }
  localHealthRequest = true;
  try {
    const [response] = await Promise.all([
      api.fetch(`/api/health.php?ts=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
      sincronizarRelogio(),
    ]);
    const result = await response.json().catch(() => ({}));
    currentInstallationMode = result.installation_mode === "central" ? "central" : "local";
    const state = response.ok && result.status === "ok" ? "online" : "degraded";
    store.state.serverStatus = state === "online" ? "ONLINE" : "ERRO";
    setLocalIndicator(state, result.checked_at || Date.now(), currentInstallationMode);
    if (currentPage === "work") refreshWorkLiveView();
    if (currentPage === "settings") refreshSettingsStatusView();
  } catch (error) {
    logFrontend.aviso("indicador.saude", error);
    store.state.serverStatus = "OFFLINE";
    setLocalIndicator("offline");
    if (currentPage === "work") refreshWorkLiveView();
    if (currentPage === "settings") refreshSettingsStatusView();
  } finally {
    localHealthRequest = false;
  }
}

function installLocalIndicator() {
  if (localHealthTimer) return;
  window.addEventListener("online", () => {
    refreshLocalIndicator();
    store.flushOfflineOperations().then(() => {
      if (currentPage === "work") render();
    }).catch((error) => {
      logFrontend.aviso("fila.offline", error);
      /* a fila permanece armazenada para a próxima tentativa */
    });
  });
  window.addEventListener("offline", () => {
    usarRelogioDoPc();
    refreshLocalIndicator();
  });
  refreshLocalIndicator();
  localHealthTimer = window.setInterval(refreshLocalIndicator, 30000);
}

function installOfflineShell() {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") return;
  let reloadAfterUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadAfterUpdate) return;
    reloadAfterUpdate = false;
    window.location.reload();
  });
  navigator.serviceWorker.register("/service-worker.js?v=202610070203").then((registration) => {
    const ativarAtualizacaoSilenciosamente = () => {
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      reloadAfterUpdate = true;
      registration.waiting.postMessage({ type: "ATIVAR_NOVA_VERSAO" });
    };
    if (registration.waiting) ativarAtualizacaoSilenciosamente();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          ativarAtualizacaoSilenciosamente();
        }
      });
    });
    registration.update().catch((error) => {
      logFrontend.aviso("service-worker.atualizacao", error);
      // A aplicação continua funcional quando a verificação do cache falhar.
    });
  }).catch((error) => {
    logFrontend.aviso("service-worker.registro", error);
    // A aplicação continua funcional quando o navegador não oferece suporte ao cache offline.
  });
}

function waitForDocumentStyles() {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
  return Promise.all(
    links.map((link) => {
      if (link.sheet) return Promise.resolve();
      return new Promise((resolve) => {
        const finish = () => resolve();
        link.addEventListener("load", finish, { once: true });
        link.addEventListener("error", finish, { once: true });
      });
    }),
  );
}

// A aplicação troca telas com History API sem recarregar o documento. Cada
// tela que tem CSS próprio precisa garantir seu arquivo e sua versão antes do
// primeiro render, inclusive quando a rota inicial veio de outra página.
const SCREEN_STYLES = {
  work: "/telas/operacao/operacao.css?v=202610070203",
  import: "/telas/importar-romaneio/importar-romaneio.css?v=202610070203",
  settings: "/telas/configuracoes/configuracoes.css?v=202610070203",
  dalas: "/telas/dalas/dalas.css?v=202610070203",
  dala: "/telas/dalas/dalas.css?v=202610070203",
  "dala-edit": "/telas/dalas/dalas.css?v=202610070203",
  company: "/telas/empresa/empresa.css?v=202610020006",
};

async function ensureScreenStyles(page) {
  const href = SCREEN_STYLES[page];
  if (!href) return;
  const expectedUrl = new URL(href, window.location.href);
  const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find(
    (link) => new URL(link.href, window.location.href).pathname === expectedUrl.pathname,
  );
  if (existing?.href === expectedUrl.href) {
    if (existing.sheet) return;
    await new Promise((resolve) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", resolve, { once: true });
    });
    return;
  }
  existing?.remove();
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = expectedUrl.href;
  document.head.append(link);
  await new Promise((resolve) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
  });
  if (!link.sheet) logFrontend.aviso("tela.css", new Error(`Não foi possível carregar ${expectedUrl.pathname}.`));
}

function renderLogin(message = "") {
  const box = el("#login-error");
  if (box) {
    box.setAttribute("role", "alert");
    box.setAttribute("aria-live", "assertive");
    box.innerHTML = message
      ? `<div class="login-error">${esc(message)}</div>`
      : "";
    if (message) box.focus();
  }
}

function renderLocalActivation(data = { active: false }, message = "") {
  const status = el("#local-license-status");
  const panel = el("#local-activation");
  const error = el("#local-activation-error");
  const enabled = Boolean(data?.enabled);
  const licenseStatus = String(data?.license_status || (data?.active ? "ATIVA" : ""));
  const active = enabled && Boolean(data?.active) && licenseStatus === "ATIVA";
  const blocked = enabled && Boolean(data?.active) && licenseStatus !== "ATIVA";
  if (status) {
    status.hidden = !active && !blocked;
    status.classList.toggle("is-blocked", blocked);
    status.innerHTML = active
      ? `<strong>Licença ativa</strong><small>${esc(data.company_name || "Empresa configurada")} · @${esc(data.login_domain || "—")}</small>`
      : blocked
        ? `<strong>Licença bloqueada</strong><small>${esc(data.license_reason || "A empresa precisa ser liberada no servidor central.")}</small>`
        : "";
  }
  if (panel) panel.hidden = !enabled || active || blocked;
  if (error) {
    error.textContent = message;
    error.hidden = !message;
  }
}

function bindLocalActivationForm() {
  const form = document.querySelector("#local-activation-form");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.submitting === "1") return;
    form.dataset.submitting = "1";
    const submit = form.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Ativando…";
    }
    renderLocalActivation({ enabled: true, active: false }, "");
    try {
      const data = Object.fromEntries(new FormData(form));
      const activation = await store.activateLocalInstallation(data);
      renderLocalActivation(activation);
      const login = document.querySelector('#login-form [name="email"]');
      if (login) login.value = data.email || "";
      form.reset();
          notificar(`Instalação ativada para ${activation.company_name}.`, "sucesso");
    } catch (error) {
      renderLocalActivation(
        { enabled: true, active: false },
        error.message || "Não foi possível ativar esta instalação.",
      );
    } finally {
      form.dataset.submitting = "0";
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Ativar este PC";
      }
    }
  });
}

function isMobileMenuViewport() {
  return window.matchMedia(
    "(max-width: 760px), (orientation: landscape) and (max-width: 900px)",
  ).matches;
}

function setMobileMenuState(open) {
  document.body.classList.toggle("mobile-menu-open", open);
  document.documentElement.classList.toggle("mobile-menu-open", open);
}

function hydrateChrome() {
  document.body.classList.toggle("work-page", currentPage === "work");
  const shell = document.getElementById("shell");
  const menuToggle = document.querySelector('[data-action="toggle-menu"]');
  const nav = document.querySelector(".sidebar nav");
  if (nav) nav.id = "trace-sidebar-nav";
  if (menuToggle) {
    menuToggle.setAttribute("aria-controls", "trace-sidebar-nav");
    const mobileOpen = shell?.classList.contains("mobile-menu-open") || false;
    menuToggle.setAttribute("aria-expanded", String(mobileOpen));
    menuToggle.setAttribute("title", mobileOpen ? "Fechar menu" : "Abrir menu");
    if (menuToggle.dataset.menuBound !== "1") {
      menuToggle.dataset.menuBound = "1";
      menuToggle.dataset.actionBound = "1";
      menuToggle.addEventListener("click", () => {
        const currentShell = document.querySelector(".shell");
        if (isMobileMenuViewport()) {
          const open = currentShell?.classList.toggle("mobile-menu-open") || false;
          setMobileMenuState(open);
          menuToggle.setAttribute("aria-expanded", String(open));
          menuToggle.setAttribute("title", open ? "Fechar menu" : "Abrir menu");
          return;
        }
        const collapsed = currentShell?.classList.toggle("sidebar-collapsed") || false;
        try {
          localStorage.setItem("trace-sidebar-collapsed", collapsed ? "1" : "0");
        } catch (storageError) {
          /* modo privado */
        }
      });
    }
  }
  if (shell && sidebarCollapsed()) shell.classList.add("sidebar-collapsed");
  if (nav)
    nav.innerHTML = NAV_GROUPS.map(([group, items]) => {
      const permitted = items.filter(([page]) => isAllowedPage(page));
      if (!permitted.length) return "";
      return `<span class="nav-label">${esc(group)}</span>${permitted.map(([page, label]) => `<a class="nav-item${page === currentPage ? " active" : ""}${["dashboard", "dalas"].includes(page) ? " nav-section-end" : ""}" data-page="${page}" data-label="${esc(label)}" href="${pagePath(page)}"><span class="nav-icon">${navigationIcon(page)}</span><span class="nav-text">${esc(label)}</span></a>`).join("")}`;
    }).join("");
  if (nav) nav.classList.add("is-hydrated");
  const pageLabel = PAGE_LABELS[currentPage] || "Dallogix Trace";
  document.title = `${pageLabel} • Dallogix Trace`;
  const pageHeading = document.querySelector(".topbar h1");
  if (pageHeading) {
    pageHeading.innerHTML = `<span class="brand-context">TracePlatform</span><small>/ Dallogix Trace</small><span class="page-context"> · ${esc(pageLabel)}</span>`;
  }
  installLocalIndicator();
  const userRole = normalizeRole(authenticatedUser?.role);
  el("#user-avatar").textContent = (authenticatedUser?.name || "A")
    .slice(0, 1)
    .toUpperCase();
  el("#user-name").textContent = authenticatedUser?.name || "";
  el("#user-role").textContent = ROLE_LABELS[userRole] || (authenticatedUser?.role || "");
}
function renderScreen() {
  hydrateChrome();
  if (currentPage === "work") {
    document.querySelector("#trace-notificacoes")?.replaceChildren();
  }
  el("#screen-root").innerHTML = screens[currentPage](store);
  bindActions();
  bindForms();
  installRelativeTimeRefresh();
  if (["settings", "dalas", "dala"].includes(currentPage)) atualizarStatusDasDalas(store);
  workViewSignature = currentPage === "work" ? workStructureSignature() : "";
  if (currentPage === "work") startWorkPolling();
  else stopWorkPolling();
  if (currentPage === "settings") settingsRealtime.start();
  else settingsRealtime.stop();
}
// Mantém uma entrada global para atualizações em tempo real e inicialização.
// Handlers de uma tela usam a guarda local de bindActions/bindForms abaixo.
function render() {
  renderScreen();
}
function stopWorkPolling() {
  workRealtime.stop();
}
function startWorkPolling() {
  workRealtime.start();
}
function workStructureSignature() {
  const pending = (store.state.pendingReadings || []).map((reading) => reading.id).join(",");
  const unselectedLoadings = store.state.selectedLoadingId
    ? []
    : (store.state.activeLoadings || []).map((loading) => [
        loading.id,
        loading.equipment_id,
        loading.state,
        loading.detected_bags,
      ]);
  const loadingItems = (store.state.loadingItems || []).map((item) => [
    item.product_id,
    item.loaded_quantity,
    item.planned_quantity,
  ]);
  const command = store.state.plcCommand;
  return JSON.stringify([
    store.state.selectedLoadingId || null,
    unselectedLoadings,
    store.state.emergency,
    store.state.operationalState,
    pending,
    command?.id || null,
    command?.command || null,
    command?.status || null,
    command?.response_message || null,
    store.state.commandIntent?.id || null,
    store.state.commandIntent?.command || null,
    store.state.commandIntent?.status || null,
    store.clpDisponivel(),
    loadingItems,
  ]);
}
function refreshWorkLiveView() {
  const detectedBags = Number(store.state.detectedBags) || 0;
  const planned = Number(store.state.planned) || 0;
  const remaining = Math.max(0, planned - detectedBags);
  const percent = planned > 0 ? Math.min(100, Math.round((detectedBags / planned) * 100)) : 0;
  const values = {
    planned: numero(planned),
    detected: numero(detectedBags),
    remaining: numero(remaining),
    "remaining-label": remaining === 0
      ? "Nenhuma leitura pendente"
      : `Falta${remaining === 1 ? "" : "m"} ${numero(remaining)} leitura${remaining === 1 ? "" : "s"} válida${remaining === 1 ? "" : "s"}`,
    "progress-percent": `${percent}%`,
    "progress-count": `${numero(detectedBags)} / ${numero(planned)} sacas`,
  };
  Object.entries(values).forEach(([key, value]) => {
    document.querySelectorAll(`[data-live="${key}"]`).forEach((node) => {
      node.textContent = String(value);
    });
  });
  const progressBar = document.querySelector('[data-live="progress-bar"]');
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
    progressBar.parentElement?.setAttribute("aria-valuenow", String(percent));
  }
  const endNotice = document.querySelector('[data-live="end-notice"]');
  if (endNotice) {
    const threshold = planned > 0 ? Math.max(1, Math.ceil(planned * 0.1)) : 0;
    const nearEnd = planned > 0 && detectedBags > 0 && remaining > 0 && remaining <= threshold;
    const complete = planned > 0 && remaining === 0;
    endNotice.textContent = complete
      ? "Quantidade programada atingida. Confira as leituras finais."
      : nearEnd
        ? "Atenção: o romaneio está próximo do fim."
        : "";
    endNotice.hidden = !complete && !nearEnd;
    endNotice.classList.toggle("complete", complete);
    endNotice.classList.toggle("near-end", nearEnd && !complete);
  }
}

function refreshSettingsStatusView() {
  const devices = store.state.monitoring?.dispositivos || [];
  const presentations = [];
  document.querySelectorAll("[data-device-status-card]").forEach((card) => {
    const type = card.dataset.deviceStatusCard;
    const equipmentId = Number(card.dataset.liveStatusEquipment) || null;
    const device = type === "SERVER"
      ? null
      : devices.find((item) => item.device_type === type &&
          (!equipmentId || Number(item.equipment_id) === equipmentId));
    const value = type === "SERVER"
      ? (store.state.serverStatus || "DESCONHECIDO")
      : (device?.status || "NAO_REGISTRADO");
    const presentation = apresentacaoStatusDispositivo(value);
    presentations.push(presentation);
    card.className = `settings-device-status-card ${presentation.tone}`;
    const status = card.querySelector("[data-live-status]");
    if (status) {
      status.textContent = presentation.label;
      status.className = `status-value status-${presentation.tone}`;
    }
    const detail = card.querySelector("[data-live-status-detail]");
    if (detail) detail.textContent = presentation.detail;
  });

  const onlineCount = presentations.filter((status) => status.online).length;
  const attentionCount = Math.max(0, presentations.length - onlineCount);
  const onlineSummary = document.querySelector('[data-device-summary="online-count"]');
  const attentionSummary = document.querySelector('[data-device-summary="attention-count"]');
  const attentionLabel = document.querySelector('[data-device-summary="attention-label"]');
  if (onlineSummary) onlineSummary.textContent = `${onlineCount}/${presentations.length}`;
  if (attentionSummary) attentionSummary.textContent = String(attentionCount);
  if (attentionLabel) attentionLabel.textContent = "sem sinal";

  const centralSync = store.state.syncStatus?.central_sync || {};
  const pcStatus = String(centralSync.pc_status || (centralSync.pc_online ? "ONLINE" : "DESCONHECIDO")).toUpperCase();
  const pcLabel = !store.state.syncStatus
    ? "Status da sincronização indisponível"
    : !centralSync.configured
      ? "Sincronização central não configurada"
      : !centralSync.installation_registered
        ? "Instalação ainda não registrada"
        : ({
            ONLINE: "PC industrial online",
            OFFLINE: "PC industrial sem comunicação",
            ERRO: "PC industrial com erro",
            DESCONHECIDO: "PC industrial sem sinal",
          }[pcStatus] || "Status do PC industrial desconhecido");
  const pcTone = pcStatus === "ONLINE" ? "online" : ["OFFLINE", "ERRO"].includes(pcStatus) ? "offline" : "unknown";
  const updateConnectivity = (key, tone, label) => {
    const row = document.querySelector(`[data-settings-connectivity="${key}"]`);
    const dot = row?.querySelector("[data-settings-connectivity-dot]");
    const text = row?.querySelector("[data-settings-connectivity-label]");
    if (dot) dot.className = `status-dot ${tone}`;
    if (text) text.textContent = label;
  };
  updateConnectivity("pc", pcTone, pcLabel);

  const configuredDalas = store.state.configuration?.dalas || [];
  const dalaStatuses = store.state.dalaStatuses || [];
  const onlineDalas = dalaStatuses.filter((dala) => String(dala.status).toUpperCase() === "ONLINE").length;
  const offlineDalas = dalaStatuses.filter((dala) => ["OFFLINE", "ERRO"].includes(String(dala.status).toUpperCase())).length;
  const unknownDalas = Math.max(0, configuredDalas.length - onlineDalas - offlineDalas);
  const dalaLabel = configuredDalas.length === 0
    ? "Dalas não cadastradas"
    : onlineDalas === configuredDalas.length
      ? "Dalas online"
      : offlineDalas === configuredDalas.length
        ? "Dalas sem comunicação"
        : onlineDalas > 0
          ? "Dalas parcialmente online"
          : "Dalas sem status";
  const dalaTone = configuredDalas.length === 0 || unknownDalas > 0 || (onlineDalas > 0 && offlineDalas > 0)
    ? "unknown"
    : offlineDalas > 0
      ? "offline"
      : "online";
  updateConnectivity("dalas", dalaTone, dalaLabel);

  const statusByEquipment = new Map(dalaStatuses.map((status) => [String(status.equipment_id), status]));
  document.querySelectorAll(".dala-status[data-equipment-id]").forEach((cell) => {
    const status = statusByEquipment.get(String(cell.dataset.equipmentId));
    const raw = String(status?.status || "DESCONHECIDO").toUpperCase();
    const tone = raw === "ONLINE" ? "online" : ["OFFLINE", "ERRO"].includes(raw) ? "offline" : "unknown";
    cell.innerHTML = `<span class="status-dot ${tone}"></span>${esc(status?.message || (raw === "ONLINE" ? "Online" : raw === "OFFLINE" ? "Sem comunicação" : "Status indisponível."))}`;
  });
}
let relativeTimeTimer = null;
function refreshRelativeTimes() {
  document.querySelectorAll("[data-relative-time]").forEach((node) => {
    const value = node.dataset.relativeTime || "";
    const text = relativo(value);
    if (node.dataset.relativeRendered === text) return;
    node.dataset.relativeRendered = text;
    const icon = node.querySelector(".status-dot");
    if (icon) node.replaceChildren(icon, document.createTextNode(text));
    else node.textContent = text;
  });
}
function installRelativeTimeRefresh() {
  if (relativeTimeTimer) window.clearInterval(relativeTimeTimer);
  refreshRelativeTimes();
  // Os horários relativos não precisam de precisão de um segundo. Atualizar
  // a lista inteira a cada segundo força layout durante a rolagem, sobretudo
  // no WebView2 do PC industrial.
  relativeTimeTimer = window.setInterval(refreshRelativeTimes, 5000);
}
function installInteractionGuards() {
  document.addEventListener("dragstart", (event) => {
    if (event.target.closest("a, button, img, svg, [data-action]"))
      event.preventDefault();
  });
  document.addEventListener("dragover", (event) => {
    if (event.target.closest("a, button, img, svg, [data-action]"))
      event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    if (event.target.closest("a, button, img, svg, [data-action]"))
      event.preventDefault();
  });
}
function downloadCsv(filename, rows) {
  const csvCell = (value) => {
    let text = String(value ?? "");
    // Planilhas interpretam células iniciadas por estes caracteres como fórmulas.
    // Dados operacionais exportados devem permanecer texto ao abrir no Excel/LibreOffice.
    if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = rows
    .map((row) =>
      row
        .map(csvCell)
        .join(";"),
    )
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }),
  );
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function bindActions() {
  const renderContextId = renderRequestId;
  // Uma resposta assíncrona pode chegar depois que o operador trocou de tela.
  // Nesse caso, a resposta pertence à tela anterior e não deve sobrescrever o
  // conteúdo que já foi aberto. O identificador só muda em renderPage().
  const render = () => {
    if (renderContextId !== renderRequestId) return;
    renderScreen();
  };
  if (!document.body.dataset.shellInteractionsBound) {
    document.body.dataset.shellInteractionsBound = "1";
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
      const shell = document.querySelector(".shell");
      const toggle = document.querySelector('[data-action="toggle-menu"]');
      if (!shell?.classList.contains("mobile-menu-open")) return;
      shell.classList.remove("mobile-menu-open");
      setMobileMenuState(false);
        toggle?.setAttribute("aria-expanded", "false");
        toggle?.setAttribute("title", "Abrir menu");
      });
      document.addEventListener("click", (event) => {
        const shell = document.querySelector(".shell");
        if (!shell?.classList.contains("mobile-menu-open")) return;
        if (event.target.closest(".sidebar, [data-action=\"toggle-menu\"]")) return;
        shell.classList.remove("mobile-menu-open");
        setMobileMenuState(false);
        const toggle = document.querySelector('[data-action="toggle-menu"]');
        toggle?.setAttribute("aria-expanded", "false");
        toggle?.setAttribute("title", "Abrir menu");
      });
    }
  document.querySelectorAll("[data-action]").forEach((node) => {
    if (node.dataset.actionBound === "1") return;
    node.dataset.actionBound = "1";
    node.addEventListener("click", async () => {
      const action = node.dataset.action;
      // Botões com uma ação declarada precisam seguir sua rota contextual
      // (por exemplo, Dala aberta pelo dashboard volta ao dashboard). O
      // fallback de histórico fica reservado para botões sem rota própria.
      if (node.classList.contains("page-back") && !action) {
        if (window.history.length > 1) window.history.back();
        else await navigate(defaultPage(), "", { replace: true });
        return;
      }
      if (FORM_ACTIONS.has(action)) {
        // Botões `submit` já disparam o evento do formulário. Chamar
        // requestSubmit() novamente aqui duplicava cadastros e comandos.
        if (node.getAttribute("type") !== "submit") {
          node.closest("form")?.requestSubmit();
        }
        return;
      }
      if (action === "reload-page") {
        await renderPage();
        return;
      }
      if (action === "reload-monitoring") {
        if (node.dataset.busy === "1") return;
        node.dataset.busy = "1";
        node.disabled = true;
        try {
          await Promise.all([
            store.loadMonitoring(),
            store.loadSyncStatus(),
            store.loadDalaStatuses(),
          ]);
          refreshSettingsStatusView();
        } catch (error) {
          notificar(error.message || "Não foi possível atualizar os estados.");
        } finally {
          node.disabled = false;
          node.dataset.busy = "0";
        }
        return;
      }
      if (action === "toggle-menu") {
        const shell = document.querySelector(".shell");
        if (isMobileMenuViewport()) {
          const open = shell?.classList.toggle("mobile-menu-open") || false;
          setMobileMenuState(open);
          node.setAttribute("aria-expanded", String(open));
          node.setAttribute("title", open ? "Fechar menu" : "Abrir menu");
          return;
        }
        const collapsed = shell
          ? shell.classList.toggle("sidebar-collapsed")
          : false;
        try {
          localStorage.setItem(
            "trace-sidebar-collapsed",
            collapsed ? "1" : "0",
          );
        } catch (storageError) {
          /* modo privado */
        }
        return;
      }
      if (action === "toggle-manifest-filters") {
        const panel = document.querySelector("#manifest-filters-panel");
        if (!panel) return;
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        node.setAttribute("aria-expanded", String(willOpen));
        return;
      }
      if (action === "toggle-user-create-password") {
        const input = document.getElementById(
          node.getAttribute("aria-controls") || "user-create-password",
        );
        if (!input) return;
        const willShow = input.type === "password";
        input.type = willShow ? "text" : "password";
        node.textContent = willShow ? "Ocultar senha" : "Ver senha";
        node.setAttribute("aria-label", willShow ? "Ocultar senha" : "Ver senha");
        node.setAttribute("aria-pressed", String(willShow));
        return;
      }
      if (action === "clear-manifest-date") {
        const form = document.querySelector("#manifest-filters");
        const field = form?.elements?.namedItem(node.dataset.field || "");
        if (!field) return;
        field.value = "";
        field.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      if (action === "open-company") {
        navigate("company", `?id=${node.dataset.id}&from=${currentPage}`);
        return;
      }
      if (action === "archive-company") {
        const name = node.dataset.name || "esta empresa";
        if (!await confirmarAcao(`Arquivar a empresa "${name}"? Os dados serão preservados e os logins deixarão de acessar o sistema.`)) return;
        try {
          await store.setCompanyArchiveState(node.dataset.id, true);
          notificar("Empresa arquivada. Os dados foram preservados.");
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "restore-company") {
        const name = node.dataset.name || "esta empresa";
        if (!await confirmarAcao(`Restaurar a empresa "${name}" e liberar novamente os acessos?`)) return;
        try {
          await store.setCompanyArchiveState(node.dataset.id, false);
          notificar("Empresa restaurada.");
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "delete-company-permanently") {
        const name = node.dataset.name || "esta empresa";
        if (!await confirmarAcao(`Excluir definitivamente a empresa "${name}"? Os dados não poderão ser recuperados.`)) return;
        const password = await solicitarTexto("Digite sua senha atual para confirmar a exclusão definitiva:", { tipo: "password", confirmar: "Validar senha" });
        if (password === null) return;
        const confirmation = await solicitarTexto(`Digite exatamente o nome da empresa:\n${name}`, { confirmar: "Confirmar nome" });
        if (confirmation === null) return;
        const credentials = { password, confirmation };
        try {
          await store.deleteCompany(node.dataset.id, { permanent: true, ...credentials });
          notificar("Empresa excluída definitivamente.");
          render();
        } catch (error) {
          if (error.status === 409) {
            const purge = await confirmarAcao(
              `A empresa "${name}" possui dados vinculados. Deseja apagar também todos os dados arquivados? Esta ação não poderá ser desfeita.`,
            );
            if (!purge) return;
            try {
              await store.deleteCompany(node.dataset.id, { permanent: true, force: true, ...credentials });
              notificar("Empresa e dados vinculados excluídos definitivamente.");
              render();
            } catch (purgeError) {
              notificar(purgeError.message);
            }
            return;
          }
          notificar(error.message);
        }
        return;
      }
      if (action === "link-industrial-pc-dala") {
        const form = node.closest(".industrial-pc-link-form");
        const installationId = form?.dataset.installationId;
        const equipmentId = form?.elements?.namedItem("equipment_id")?.value;
        if (!installationId || !equipmentId) {
          notificar("Selecione a Dala que pertence a este PC industrial.");
          return;
        }
        try {
          await store.assignIndustrialEquipment(installationId, equipmentId);
          await store.loadCompanyDetail();
          render();
          notificar("Dala vinculada ao PC industrial.");
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "generate-industrial-pc-code") {
        try {
          await store.generateIndustrialActivationCode(node.dataset.id);
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "toggle-industrial-pc-access") {
        const blocked = node.dataset.blocked === "true";
        const activated = node.dataset.activated === "true";
        const name = node.dataset.name || "este PC industrial";
        const confirmation = blocked
          ? activated
            ? "Bloquear o acesso remoto do PC industrial \"" + name + "\"? A operação local continuará funcionando."
            : "Bloquear a ativação do PC industrial \"" + name + "\"? Ele não poderá receber um código até ser liberado."
          : activated
            ? "Liberar o acesso remoto do PC industrial \"" + name + "\"? A sincronização será retomada."
            : "Liberar a ativação do PC industrial \"" + name + "\" para permitir a geração de um código?";
        if (!await confirmarAcao(confirmation)) return;
        try {
          await store.setIndustrialAccessBlocked(node.dataset.id, blocked);
          render();
          notificar(blocked
            ? (activated ? "Acesso remoto bloqueado. O PC continua funcionando localmente." : "Ativação bloqueada para este PC.")
            : (activated ? "Acesso remoto liberado novamente." : "Ativação liberada. Agora é possível gerar um código."));
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "archive-industrial-pc") {
        const name = node.dataset.name || "este PC industrial";
        if (!await confirmarAcao("Arquivar \"" + name + "\"? O acesso e o código serão revogados. A Dala e o histórico serão preservados.")) return;
        try {
          await store.setIndustrialInstallationArchived(node.dataset.id, true);
          render();
          notificar("PC industrial arquivado. Para usá-lo novamente, restaure o cadastro e faça uma nova ativação.");
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "restore-industrial-pc") {
        try {
          await store.setIndustrialInstallationArchived(node.dataset.id, false);
          render();
          notificar("PC restaurado. Gere um novo código e faça a ativação no PC industrial.");
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "delete-industrial-pc") {
        const name = node.dataset.name || "este PC industrial";
        if (!await confirmarAcao("Excluir definitivamente \"" + name + "\"? Esta ação não pode ser desfeita. A Dala e o histórico de operação serão mantidos.")) return;
        try {
          await store.deleteArchivedIndustrialInstallation(node.dataset.id);
          render();
          notificar("Cadastro do PC industrial excluído. A Dala e o histórico foram preservados.");
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "generate-company-activation") {
        try {
          await store.generateCompanyActivation(node.dataset.id);
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "copy-company-activation") {
        const code = node.dataset.code || "";
        try {
          await navigator.clipboard.writeText(code);
          notificar("Código copiado.");
        } catch (error) {
          notificar(`Código de ativação: ${code}`);
        }
        return;
      }
      if (action === "toggle-license") {
        const active = node.dataset.status === "ATIVA";
        const reason = active
          ? await solicitarTexto("Motivo do bloqueio da licença:", { valorInicial: "Bloqueio manual", confirmar: "Bloquear licença" })
          : "Licença desbloqueada manualmente";
        if (reason === null) return;
        try {
          await store.updateLicense({
            company_id: Number(node.dataset.id),
            status: active ? "BLOQUEADA" : "ATIVA",
            blocked_reason: active ? reason : "",
          });
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "back-companies") {
        const from = new URLSearchParams(window.location.search).get("from");
        navigate(["master-home", "companies"].includes(from || "") ? from : "companies");
        return;
      }
      if (action === "back-settings") {
        navigate("settings");
        return;
      }
      if (action === "back-company") {
        navigate("company", `?id=${encodeURIComponent(node.dataset.companyId || "")}&from=companies`);
        return;
      }
      if (action === "open-users") {
        navigate(
          "users",
          node.dataset.companyId
            ? `?company_id=${node.dataset.companyId}&from=company`
            : "",
        );
        return;
      }
      if (action === "toggle-user") {
        const active = node.dataset.active !== "1";
        if (
          !await confirmarAcao(
            `${active ? "Ativar" : "Desativar"} o login de ${node.dataset.name}?`,
          )
        )
          return;
        try {
          await store.updateUser({
            id: node.dataset.id,
            name: node.dataset.name,
            role: node.dataset.role,
            active,
            ...(store.state.userRole === "ADMIN_DALLOGIX" &&
            store.state.selectedCompanyId
              ? { company_id: store.state.selectedCompanyId }
              : {}),
          });
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "reset-user-password") {
        const password = await solicitarTexto(
          `Nova senha para ${node.dataset.name} (mínimo 6 caracteres):`,
          { tipo: "password", confirmar: "Atualizar senha" },
        );
        if (password === null) return;
        if (password.length < 6) {
          notificar("A senha deve ter pelo menos 6 caracteres.");
          return;
        }
        try {
          await store.updateUser({
            id: node.dataset.id,
            name: node.dataset.name,
            role: node.dataset.role,
            active: node.dataset.active === "1",
            password,
            ...(store.state.userRole === "ADMIN_DALLOGIX" &&
            store.state.selectedCompanyId
              ? { company_id: store.state.selectedCompanyId }
              : {}),
          });
          notificar("Senha atualizada.");
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "logout") {
        await api.fetch("/api/logout.php", {
          method: "POST",
          headers: store.csrfToken ? { "X-CSRF-Token": store.csrfToken } : {},
        });
        window.location.href = pagePath("login");
        return;
      }
      if (action === "download-audit-report") {
        try {
          const id = Number(node.dataset.id);
          if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Romaneio inválido.");
          const response = await api.fetch(`/api/relatorio_auditoria.php?romaneio_id=${id}`, {
            credentials: "same-origin",
            headers: { Accept: "application/pdf, application/json" },
          });
          if (response.status === 401) {
            notificar("Sua sessão expirou. Entre novamente para baixar o relatório.");
            window.location.href = pagePath("login");
            return;
          }
          if (!response.ok) {
            const raw = await response.text();
            let result = {};
            try {
              result = JSON.parse(raw);
            } catch {
              // A API deve responder JSON, mas não transforma uma resposta HTML
              // de proxy em uma mensagem vazia para quem opera a tela.
            }
            throw new Error(result.error || "Não foi possível baixar o relatório.");
          }
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.toLowerCase().includes("application/pdf")) {
            throw new Error("O servidor não retornou um relatório PDF válido.");
          }
          const blob = await response.blob();
          if (!blob.size) throw new Error("O relatório retornou vazio.");
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `romaneio-${id}.pdf`;
          link.hidden = true;
          document.body.append(link);
          link.click();
          window.setTimeout(() => {
            link.remove();
            URL.revokeObjectURL(url);
          }, 60000);
        } catch (error) {
          notificar(error.message || "Não foi possível baixar o relatório.");
        }
        return;
      }
      if (action === "retry-sync") {
        try {
          const result = await store.retrySync(node.dataset.id);
          notificar(
            result?.reason ||
              (result?.processed ? "Evento enviado." : "Evento reprocessado."),
          );
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "goto-manifests") {
        const returnToDashboard = new URLSearchParams(window.location.search).get("from") === "dashboard";
        navigate(returnToDashboard ? "dashboard" : "manifests");
        return;
      }
      if (action === "manifest-page") {
        try {
          await store.setManifestPage(node.dataset.page);
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "goto-dalas") {
        navigate("dalas");
        return;
      }
      if (action === "goto-companies") {
        navigate("companies");
        return;
      }
      if (action === "goto-error-logs") {
        navigate("error-logs");
        return;
      }
      if (action === "reload-master-home") {
        try {
          await Promise.all([store.loadCompanies(), store.loadErrorLogs()]);
          render();
        } catch (error) {
          notificar(error.message || "Não foi possível atualizar a visão geral.");
        }
        return;
      }
      if (action === "new-manifest") {
        navigate("import");
        return;
      }
      if (action === "view-manifest") {
        const fromDashboard = currentPage === "dashboard" ? "&from=dashboard" : "";
        navigate("manifest", `?id=${node.dataset.id}${fromDashboard}`);
        return;
      }
      if (action === "edit-manifest") {
        navigate("manifest-edit", `?id=${node.dataset.id}`);
        return;
      }
      if (action === "prepare-manifest") {
        navigate("division", `?id=${encodeURIComponent(node.dataset.id)}${isDashboardReturn() ? "&from=dashboard" : ""}`);
        return;
      }
      if (action === "cancel-manifest") {
        const reason = await solicitarTexto("Informe o motivo do cancelamento do romaneio:", { obrigatorio: true }) || "";
        if (!reason.trim()) return;
        if (!await confirmarAcao("Confirma o cancelamento deste romaneio? Essa ação não poderá ser desfeita.")) return;
        if (!await confirmarAcao("SEGUNDA CONFIRMAÇÃO: cancelar este romaneio agora?")) return;
        try {
          await store.cancelManifest(node.dataset.id || queryId(), reason.trim());
          notificar("Romaneio cancelado.");
          await navigate(isDashboardReturn() ? "dashboard" : "manifests");
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "cancel-manifest-progress") {
        const reason = await solicitarTexto("Informe o motivo do cancelamento da operação:", { obrigatorio: true }) || "";
        if (!reason.trim()) return;
        if (!await confirmarAcao("Confirma o cancelamento? A operação precisa estar pausada ou em emergência.")) return;
        try {
          await store.cancelManifest(node.dataset.id || queryId(), reason.trim());
          notificar("Operação cancelada e registrada na auditoria.");
          await navigate(isDashboardReturn() ? "dashboard" : "manifests");
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "back-manifest") {
        navigate("manifest", `?id=${encodeURIComponent(queryId() || "")}${isDashboardReturn() ? "&from=dashboard" : ""}`);
        return;
      }
      if (action === "resume-loading") {
        store.state.selectedLoadingId = Number(node.dataset.loadingId) || null;
        navigate("work", dashboardReturnQuery());
        return;
      }
      if (action === "select-loading") {
        try {
          await store.loadActiveLoading(node.dataset.id);
          await store.loadMonitoring();
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "change-loading") {
        store.state.selectedLoadingId = null;
        await store.loadActiveLoading(null);
        render();
        return;
      }
      if (action === "open-summary") {
        if (!["FINALIZANDO", "FINALIZADO"].includes(store.state.operationalState)) {
          notificarForaDaOperacao("O resumo final ficará disponível quando a quantidade prevista for atingida.", "aviso");
          return;
        }
        await navigate("summary");
        return;
      }
      if (action === "back-work") {
        await navigate("work");
        return;
      }
      if (action === "view-dala") {
        const from =
          currentPage === "dashboard" ? "dashboard" : queryReturnPage();
        navigate("dala", `?id=${node.dataset.id}&from=${from}`);
        return;
      }
      if (action === "edit-dala") {
        navigate(
          "dala-edit",
          `?id=${node.dataset.id}&from=${queryReturnPage()}`,
        );
        return;
      }
      if (action === "back-dala") {
        navigate(queryReturnPage());
        return;
      }
      if (action === "open-dala-operation") {
        store.state.selectedLoadingId = Number(node.dataset.loadingId) || null;
        await navigate("work");
        return;
      }
      if (action === "reload-dala-diagnostics") {
        try {
          await store.loadDalaCommandHistory(node.dataset.id);
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "reload-error-logs") {
        try {
          await Promise.all([store.loadErrorLogs(), store.loadTechnicalDiagnostics(), store.loadDeadLetters()]);
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "requeue-dead-letter" || action === "resolve-dead-letter") {
        const verb = action === "requeue-dead-letter" ? "reenfileirar" : "resolver";
        const note = await solicitarTexto(`Informe o motivo para ${verb} este evento:`, { obrigatorio: true });
        if (note === null || !note.trim()) return;
        if (!await confirmarAcao(`Confirma ${verb} este evento da fila morta?`)) return;
        try {
          await store.updateDeadLetter(
            node.dataset.id,
            action === "requeue-dead-letter" ? "requeue" : "resolve",
            note.trim(),
          );
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "reload-dalas") {
        store.state.equipmentsLoaded = false;
        store.state.equipmentsError = "";
        render();
        await store.loadEquipments({ force: true });
        if (currentPage === "dalas") render();
        return;
      }
      if (action === "toggle-product-form") {
        store.state.productFormOpen = !store.state.productFormOpen;
        store.state.editingProductId = null;
        render();
        return;
      }
      if (action === "cancel-product") {
        store.state.productFormOpen = false;
        store.state.editingProductId = null;
        render();
        return;
      }
      if (action === "edit-product") {
        store.state.productFormOpen = true;
        store.state.editingProductId = node.dataset.id;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (action === "toggle-product-active") {
        const product = (store.state.products || []).find(
          (item) => Number(item.id) === Number(node.dataset.id),
        );
        if (!product) return;
        const nextActive = node.dataset.active === "1" ? 0 : 1;
        const productForm = document.querySelector("#product-form");
        const raw = productForm
          ? Object.fromEntries(new FormData(productForm))
          : product;
        try {
          await store.updateProduct({
            id: product.id,
            ...raw,
            active: nextActive,
          });
          notificar(nextActive ? "Produto ativado." : "Produto desativado.");
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "delete-product-edit") {
        if (!await confirmarAcao(`Excluir o produto "${node.dataset.name}"? Os itens de romaneios vinculados serão removidos.`)) return;
        try {
          await store.deleteProduct(node.dataset.id);
          notificar("Produto excluído.");
          store.state.productFormOpen = false;
          store.state.editingProductId = null;
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (action === "toggle-dala-form") {
        store.state.dalaFormOpen = !store.state.dalaFormOpen;
        render();
        return;
      }
      if (action === "delete-dala") {
        if (!["ADMIN_DALLOGIX", "ADMIN_EMPRESA"].includes(store.state.userRole)) {
          notificar("Somente administradores podem excluir Dala.");
          return;
        }
        if (!await confirmarAcao(`Excluir a Dala "${node.dataset.name}"?`)) return;
        if (!await confirmarAcao(`SEGUNDA CONFIRMAÇÃO: excluir a Dala "${node.dataset.name}" definitivamente?`)) return;
        try {
          await store.deleteEquipment(node.dataset.id);
          notificar("Dala excluída.");
          render();
        } catch (error) {
          notificar(error.message);
        }
        return;
      }
      if (["start-machine", "stop-machine", "run", "stop", "reverse-machine", "reverse-on", "reverse-off", "reverse-toggle", "emergency"].includes(action)) {
        await executarComandoDeOperacao(node, action);
        return;
      }
      if (action === "add-item") {
        const tbody = document.querySelector("#manifest-items tbody");
        if (tbody) tbody.insertAdjacentHTML("beforeend", linhaItemRomaneio(store));
        return;
      }
      if (action === "remove-item") {
        const rows = document.querySelectorAll("#manifest-items tbody tr");
        if (rows.length > 1) node.closest("tr")?.remove();
        return;
      }
      if (screens[action]) navigate(action);
      else if (action === "unlock") {
        node.disabled = true;
        try {
          await servicoEmergencia.liberar();
          render();
        } catch (error) {
          notificarForaDaOperacao(error.message, "erro");
        } finally {
          node.disabled = false;
        }
      } else if (action === "finish") {
        try {
          const justification =
            store.state.loaded < store.state.planned
              ? await solicitarTexto("Justificativa obrigatória para finalizar com divergência:", { obrigatorio: true, multilinha: true }) || ""
              : "";
          if (store.state.loaded < store.state.planned && !justification.trim()) return;
          await store.finishLoading(justification.trim());
          render();
        } catch (error) {
          notificarForaDaOperacao(error.message, "erro");
        }
      } else if (action === "export") {
        downloadCsv(`dallogix-${currentPage}.csv`, [
          ["Campo", "Valor"],
          ["Romaneio", store.state.romaneio],
          ["Caminhão", store.state.truck],
          ["Estado", store.state.operationalState],
          ["Carregado", store.state.loaded],
          ["Planejado", store.state.planned],
          [
            "Sincronização pendente",
            store.state.monitoring?.sync_pendente || 0,
          ],
        ]);
      }
    });
  });
  document.querySelectorAll(".sidebar .nav-item[data-page]").forEach((item) => {
    if (item.dataset.navigationBound === "1") return;
    item.dataset.navigationBound = "1";
    item.addEventListener("click", (event) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.button !== 0
      )
        return;
      event.preventDefault();
      if (window.matchMedia("(max-width: 760px)").matches) {
        document.querySelector(".shell")?.classList.remove("mobile-menu-open");
        setMobileMenuState(false);
        document.querySelector('[data-action="toggle-menu"]')?.setAttribute("aria-expanded", "false");
        document.querySelector('[data-action="toggle-menu"]')?.setAttribute("title", "Abrir menu");
      }
      navigate(item.dataset.page);
    });
  });
  document.querySelectorAll('input[data-action="open-users"]').forEach((node) => {
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") node.click();
    });
  });
}
function bindLoginForm() {
  const form = document.querySelector("#login-form");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const originalLabel = submit?.textContent || "Entrar no sistema";
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Entrando…";
    }
    renderLogin("");
    try {
      const data = Object.fromEntries(new FormData(form));
      const response = await api.fetch("/api/login.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.authenticated !== true) {
        renderLogin(result.error || "Login ou senha inválidos.");
        return;
      }
      authenticatedUser = result.user;
      store.setUser(authenticatedUser);
      store.setCsrfToken(result.csrf_token);
      window.location.replace(pagePath(defaultPage()));
    } catch (error) {
      logFrontend.aviso("login.conexao", error);
      renderLogin(
        "Não foi possível conectar ao servidor local. Verifique se o sistema está em execução.",
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalLabel;
      }
    }
  });
}
function setFormFeedback(form, message = "", tone = "") {
  const feedback = form?.querySelector("[data-form-feedback]");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.className = `form-feedback${tone ? ` is-${tone}` : ""}`;
}

function bindForms() {
  const renderContextId = renderRequestId;
  // Mesma proteção dos cliques: salvar/importar/filtrar não pode redesenhar
  // uma tela antiga quando o usuário já navegou para outro endereço.
  const render = () => {
    if (renderContextId !== renderRequestId) return;
    renderScreen();
  };
  const occurrenceForm = document.querySelector("#occurrence-form");
  if (occurrenceForm)
    occurrenceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await store.createOccurrence(
          Object.fromEntries(new FormData(occurrenceForm)),
        );
        render();
      } catch (error) {
        if (error.status === 401) {
          try {
            sessionStorage.setItem("trace-login-message", error.message);
          } catch (storageError) {
            /* armazenamento indisponível */
          }
          window.location.replace(pagePath("login"));
          return;
        }
        notificar(error.message);
      }
    });
  // Parâmetros de PDF: preserva valores legados não exibidos na interface.
  const pdfSettingsForm = document.querySelector("#pdf-settings-form");
  if (pdfSettingsForm)
    pdfSettingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(pdfSettingsForm));
      const pdf_field_mapping = {};
      Object.entries(raw)
        .filter(([key]) => key.startsWith("pdf_") && key !== "pdf_search_field")
        .forEach(([key, value]) => {
          if (value) pdf_field_mapping[key.slice(4)] = value;
        });
      const saved = store.state.configuration?.settings || {};
      try {
        await store.saveConfiguration({
          gateway_public_ip: saved.gateway_public_ip || "",
          pdf_field_mapping,
          pdf_search_field: raw.pdf_search_field,
        });
        notificar("Parâmetros salvos.");
        render();
      } catch (error) {
        notificar(error.message);
      }
    });
  const productForm = document.querySelector("#product-form");
  if (productForm)
    productForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (productForm.dataset.submitting === "1") return;
      const raw = Object.fromEntries(new FormData(productForm));
      const validationError = validarProduto(raw);
      if (validationError) {
        setFormFeedback(productForm, validationError, "error");
        notificar(validationError);
        return;
      }
      productForm.dataset.submitting = "1";
      productForm.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      const editingId = productForm.dataset.editing;
      try {
        if (editingId) {
          await store.updateProduct({ id: editingId, ...raw });
          notificar("Produto atualizado.");
        } else {
          await store.createProduct(raw);
          notificar("Produto cadastrado.");
        }
        store.state.productFormOpen = false;
        store.state.editingProductId = null;
        render();
      } catch (error) {
        if (error.status === 401) {
          try {
            sessionStorage.setItem("trace-login-message", error.message);
          } catch (storageError) {
            /* armazenamento indisponível */
          }
          window.location.replace(pagePath("login"));
          return;
        }
        notificar(error.message);
      } finally {
        productForm.dataset.submitting = "0";
        productForm.querySelectorAll("button").forEach((button) => {
          button.disabled = false;
        });
      }
    });
  const dalaCreateForm = document.querySelector("#dala-create-form");
  if (dalaCreateForm)
    dalaCreateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (dalaCreateForm.dataset.submitting === "1") return;
      const raw = Object.fromEntries(new FormData(dalaCreateForm));
      const validationError = validarDala(raw);
      if (validationError) {
        setFormFeedback(dalaCreateForm, validationError, "error");
        notificar(validationError);
        return;
      }
      dalaCreateForm.dataset.submitting = "1";
      dalaCreateForm.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      let created;
      try {
        created = await store.createEquipment(raw);
      } catch (error) {
        notificar(error.message);
        dalaCreateForm.dataset.submitting = "0";
        dalaCreateForm.querySelectorAll("button").forEach((button) => { button.disabled = false; });
        return;
      }
      store.state.dalaFormOpen = false;
      render();
      try {
        const connection = await store.checkEquipmentStatus(created.id);
        notificar(`Dala cadastrada. ${connection.message}`);
      } catch (error) {
        notificar(`Dala cadastrada, mas a verificação de conexão falhou: ${error.message}`);
      }
    });
  const dalaEditForm = document.querySelector("#dala-edit-form");
  if (dalaEditForm)
    dalaEditForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (dalaEditForm.dataset.submitting === "1") return;
      const raw = Object.fromEntries(new FormData(dalaEditForm));
      const validationError = validarDala(raw);
      if (validationError) {
        setFormFeedback(dalaEditForm, validationError, "error");
        notificar(validationError);
        return;
      }
      dalaEditForm.dataset.submitting = "1";
      dalaEditForm.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      try {
        await store.updateEquipment({ id: dalaEditForm.dataset.id, ...raw });
      } catch (error) {
        notificar(error.message);
        dalaEditForm.dataset.submitting = "0";
        dalaEditForm.querySelectorAll("button").forEach((button) => { button.disabled = false; });
        return;
      }
      const equipmentId = dalaEditForm.dataset.id;
      await navigate("dala", `?id=${equipmentId}&from=${queryReturnPage()}`);
      try {
        const connection = await store.checkEquipmentStatus(equipmentId);
        notificar(`Dala atualizada. ${connection.message}`);
      } catch (error) {
        notificar(`Dala atualizada, mas a verificação de conexão falhou: ${error.message}`);
      }
    });
  const manifestForm = document.querySelector("#new-manifest-form");
  if (manifestForm)
    manifestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(manifestForm));
      const scheduledDate = raw.scheduled_date;
      const today = agora();
      const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      if (!scheduledDate || scheduledDate < todayString) {
        notificar("Informe uma data igual ou posterior ao dia atual do PC industrial.");
        return;
      }
      const items = [...document.querySelectorAll("#manifest-items tbody tr")]
        .map((row) => ({
          product_id: row.querySelector('[name="item_product"]')?.value,
          quantity: row.querySelector('[name="item_quantity"]')?.value,
        }))
        .filter((item) => item.product_id && Number(item.quantity) >= 1);
      if (!items.length) {
        notificar("Adicione ao menos um item com produto e quantidade.");
        return;
      }
      if (new Set(items.map((item) => String(item.product_id))).size !== items.length) {
        notificar("Selecione cada produto apenas uma vez no romaneio.");
        return;
      }
      if (manifestForm.dataset.submitting === "1") return;
      manifestForm.dataset.submitting = "1";
      manifestForm.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      try {
        await store.createManifest({
          number: raw.number,
          scheduled_date: scheduledDate,
          plate: raw.plate,
          expedidor: raw.expedidor,
          driver_name: raw.driver_name,
          items,
        });
        notificar("Romaneio cadastrado.");
        navigate("manifests");
      } catch (error) {
        notificar(error.message);
      } finally {
        manifestForm.dataset.submitting = "0";
        manifestForm.querySelectorAll("button").forEach((button) => {
          button.disabled = false;
        });
      }
    });
  const manifestEditForm = document.querySelector("#edit-manifest-form");
  if (manifestEditForm)
    manifestEditForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(manifestEditForm));
      const today = agora();
      const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      if (!raw.scheduled_date || raw.scheduled_date < todayString) {
        notificar("Informe uma data igual ou posterior ao dia atual do PC industrial.");
        return;
      }
      const items = [...document.querySelectorAll("#manifest-items tbody tr")]
        .map((row) => ({
          product_id: row.querySelector('[name="item_product"]')?.value,
          quantity: row.querySelector('[name="item_quantity"]')?.value,
        }))
        .filter((item) => item.product_id && Number(item.quantity) >= 1);
      if (!items.length) {
        notificar("Adicione ao menos um item com produto e quantidade.");
        return;
      }
      if (new Set(items.map((item) => String(item.product_id))).size !== items.length) {
        notificar("Selecione cada produto apenas uma vez no romaneio.");
        return;
      }
      if (manifestEditForm.dataset.submitting === "1") return;
      manifestEditForm.dataset.submitting = "1";
      manifestEditForm.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      try {
        await store.updateManifest({
          romaneio_id: manifestEditForm.dataset.id,
          number: raw.number,
          scheduled_date: raw.scheduled_date,
          plate: raw.plate,
          expedidor: raw.expedidor,
          driver_name: raw.driver_name,
          items,
        });
        notificar("Romaneio atualizado.");
        await navigate("manifest", `?id=${manifestEditForm.dataset.id}`);
      } catch (error) {
        notificar(error.message);
      } finally {
        manifestEditForm.dataset.submitting = "0";
        manifestEditForm.querySelectorAll("button").forEach((button) => {
          button.disabled = false;
        });
      }
    });
  // Importação PDF: preenche o formulário manual com os campos extraídos.
  const pdfForm = document.querySelector("#pdf-form");
  if (pdfForm) {
    const pdfFile = pdfForm.querySelector(".file-input");
    const pdfFileName = pdfForm.querySelector("[data-file-name]");
    const pdfFeedback = document.querySelector("#pdf-import-feedback");
    const showPdfFeedback = (message, tone = "") => {
      if (!pdfFeedback) return;
      pdfFeedback.className = `import-feedback${tone ? ` is-${tone}` : ""}`;
      pdfFeedback.textContent = message;
    };
    pdfFile?.addEventListener("change", () => {
      pdfFileName.textContent = pdfFile.files?.[0]?.name || "Nenhum arquivo escolhido";
    });
    pdfForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const buttonNode = pdfForm.querySelector("button.button");
      if (buttonNode) buttonNode.disabled = true;
      showPdfFeedback("Lendo o PDF…");
      try {
        const data = await store.importPdf(new FormData(pdfForm));
        const fields = data.fields || {};
        const set = (name, value) => {
          const input = document.querySelector(
            `#new-manifest-form [name="${name}"]`,
          );
          if (input && value) input.value = value;
        };
        set("number", fields.codigo);
        set("scheduled_date", fields.data_iso);
        set("plate", fields.placa);
        set("expedidor", fields.expedidor);
        set("driver_name", fields.motorista);
        if (data.product && fields.quantidade_numero) {
          const tbody = document.querySelector("#manifest-items tbody");
          if (tbody) {
            tbody.innerHTML = "";
            tbody.insertAdjacentHTML(
              "beforeend",
              linhaItemRomaneio(store, data.product.id, fields.quantidade_numero),
            );
          }
        }
        const missing = data.missing || [];
        showPdfFeedback(
          `PDF importado.${missing.length ? ` Campos não encontrados: ${missing.join(", ")}.` : " Confira os dados e salve."}`,
          missing.length ? "warning" : "success",
        );
      } catch (error) {
        showPdfFeedback(error.message || "Não foi possível importar o PDF.", "error");
      } finally {
        if (buttonNode) buttonNode.disabled = false;
      }
    });
  }
  const csvForm = document.querySelector("#csv-form");
  if (csvForm) {
    const csvFile = csvForm.querySelector(".file-input");
    const csvFileName = csvForm.querySelector("[data-file-name]");
    const csvFeedback = document.querySelector("#csv-import-feedback");
    const showCsvFeedback = (message, tone = "") => {
      if (!csvFeedback) return;
      csvFeedback.className = `import-feedback${tone ? ` is-${tone}` : ""}`;
      csvFeedback.textContent = message;
    };
    csvFile?.addEventListener("change", () => {
      csvFileName.textContent = csvFile.files?.[0]?.name || "Nenhum arquivo escolhido";
    });
    csvForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = csvForm.querySelector("button.button");
      if (submit) submit.disabled = true;
      showCsvFeedback("Validando o CSV…");
      try {
        const response = await api.fetch("/api/importar_csv.php", {
          method: "POST",
          headers: store.csrfToken ? { "X-CSRF-Token": store.csrfToken } : {},
          body: new FormData(csvForm),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Falha ao importar CSV.");
        await store.loadManifests();
        showCsvFeedback(
          `${result.data.romaneios} romaneio(s), ${result.data.items} item(ns) consolidados em ${result.data.linhas} linha(s) importada(s).`,
          "success",
        );
      } catch (error) {
        showCsvFeedback(error.message || "Falha ao importar CSV.", "error");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }
  const prepareLoadingForm = document.querySelector("#prepare-loading-form");
  if (prepareLoadingForm)
    prepareLoadingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = prepareLoadingForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const raw = Object.fromEntries(new FormData(prepareLoadingForm));
        await store.prepareLoading({
          romaneio_id: queryId(),
          truck_id: raw.truck_id,
          equipment_id: raw.equipment_id,
        });
        await navigate("work", dashboardReturnQuery());
      } catch (error) {
        notificar(error.message);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  document.querySelectorAll(".reassign-loading-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const raw = Object.fromEntries(new FormData(form));
        await store.reassignLoading(form.dataset.loadingId, raw.equipment_id);
        render();
      } catch (error) {
        notificarForaDaOperacao(error.message, "erro");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  });
  document.querySelectorAll(".manual-operation-reading-form").forEach((form) => {
    const barcodeInput = form.querySelector('[name="barcode"]');
    barcodeInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || barcodeInput.disabled) return;
      event.preventDefault();
      if (typeof form.requestSubmit === "function") form.requestSubmit();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === "1") return;
      form.dataset.submitting = "1";
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      setFormFeedback(form, "Registrando leitura…");
      try {
        const raw = Object.fromEntries(new FormData(form));
        const result = await store.registerManualReading(raw.barcode);
        const messages = {
          VALIDO: result.load_status === "COMPLETO"
            ? "Código registrado e quantidade programada atingida."
            : "Código registrado e produto validado.",
          PRODUTO_INCORRETO: result.operator_alert || "Código não previsto para o carregamento; a operação foi pausada.",
          EXCESSO: result.operator_alert || "Quantidade programada atingida; a operação foi pausada.",
          SEM_LEITURA: "Leitura registrada sem código.",
        };
        const message = messages[result.result] || "Leitura registrada.";
        render();
        const currentForm = document.querySelector(".manual-operation-reading-form");
        if (currentForm) {
          setFormFeedback(currentForm, message, result.result === "VALIDO" ? "" : "error");
          currentForm.querySelector('[name="barcode"]')?.focus();
        }
      } catch (error) {
        setFormFeedback(form, error.message || "Não foi possível registrar a leitura manual.", "error");
      } finally {
        if (form.isConnected) {
          form.dataset.submitting = "";
          if (submit) submit.disabled = false;
        }
      }
    });
  });
  document.querySelectorAll(".manual-reading-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === "1") return;
      form.dataset.submitting = "1";
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const raw = Object.fromEntries(new FormData(form));
        await store.identifyReading(form.dataset.readingId, raw.barcode);
        render();
      } catch (error) {
        notificarForaDaOperacao(error.message, "erro");
      } finally {
        if (form.isConnected) {
          form.dataset.submitting = "";
          if (submit) submit.disabled = false;
        }
      }
    });
  });
  const userForm = document.querySelector("#user-create-form");
  if (userForm)
    userForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (userForm.dataset.submitting === "1") return;
      userForm.dataset.submitting = "1";
      const submit = userForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      setFormFeedback(userForm, "");
      try {
        await store.createUser(Object.fromEntries(new FormData(userForm)));
        userForm.reset();
        await store.loadUsers();
        render();
        notificar("Login criado.");
      } catch (error) {
        setFormFeedback(userForm, error.message, "error");
        notificar(error.message);
      } finally {
        userForm.dataset.submitting = "0";
        if (submit) submit.disabled = false;
      }
    });
  const companyForm = document.querySelector("#company-create-form");
  if (companyForm)
    companyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (companyForm.dataset.submitting === "1") return;
      companyForm.dataset.submitting = "1";
      const submit = companyForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      setFormFeedback(companyForm, "");
      try {
        await store.createCompany(
          Object.fromEntries(new FormData(companyForm)),
        );
        companyForm.reset();
        await store.loadCompanies();
        render();
        notificar("Empresa criada. Agora crie o login de administrador.");
      } catch (error) {
        setFormFeedback(companyForm, error.message, "error");
        notificar(error.message);
      } finally {
        companyForm.dataset.submitting = "0";
        if (submit) submit.disabled = false;
      }
    });
  const renameCompanyForm = document.querySelector("#company-rename-form");
  if (renameCompanyForm)
    renameCompanyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (renameCompanyForm.dataset.submitting === "1") return;
      renameCompanyForm.dataset.submitting = "1";
      const submit = renameCompanyForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      setFormFeedback(renameCompanyForm, "");
      try {
        const { name } = Object.fromEntries(new FormData(renameCompanyForm));
        await store.renameCompany(renameCompanyForm.dataset.companyId, name);
        await store.loadCompanyDetail();
        render();
        notificar("Empresa renomeada.");
      } catch (error) {
        setFormFeedback(renameCompanyForm, error.message, "error");
        notificar(error.message);
      } finally {
        renameCompanyForm.dataset.submitting = "0";
        if (submit) submit.disabled = false;
      }
    });
  const industrialPcCreateForm = document.querySelector("#industrial-pc-create-form");
  if (industrialPcCreateForm)
    industrialPcCreateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (industrialPcCreateForm.dataset.submitting === "1") return;
      industrialPcCreateForm.dataset.submitting = "1";
      const submit = industrialPcCreateForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      setFormFeedback(industrialPcCreateForm, "");
      try {
        const { name } = Object.fromEntries(new FormData(industrialPcCreateForm));
        await store.createIndustrialInstallation(name);
        await store.loadCompanyDetail();
        render();
        notificar("PC industrial cadastrado. Agora gere o código individual para ativá-lo.");
      } catch (error) {
        setFormFeedback(industrialPcCreateForm, error.message, "error");
        notificar(error.message);
      } finally {
        industrialPcCreateForm.dataset.submitting = "0";
        if (submit) submit.disabled = false;
      }
    });
  // Filtros de romaneios: aplicam automaticamente ao alterar/confirmar.
  const manifestFilters = document.querySelector("#manifest-filters");
  if (manifestFilters) {
    const apply = async () => {
      try {
        await store.applyManifestFilters(
          Object.fromEntries(new FormData(manifestFilters)),
        );
        render();
      } catch (error) {
        notificar(error.message);
      }
    };
    manifestFilters.addEventListener("submit", async (event) => {
      event.preventDefault();
      await apply();
    });
    manifestFilters.addEventListener("change", apply);
  }
  // Busca de produtos: filtra as linhas da tabela sem recarregar a tela.
  const productSearch = document.querySelector("#product-search");
  const usersCompanySelector = document.querySelector(
    "#users-company-selector",
  );
  if (usersCompanySelector)
    usersCompanySelector.addEventListener("change", async () => {
      store.state.selectedCompanyId = usersCompanySelector.value || null;
      await store.loadUsers();
      render();
    });
  if (productSearch)
    productSearch.addEventListener("input", () => {
      const term = productSearch.value.toLowerCase();
      store.state.productSearch = productSearch.value;
      document.querySelectorAll(".table-wrap tbody tr").forEach((row) => {
        row.style.display =
          !term || row.textContent.toLowerCase().includes(term) ? "" : "none";
      });
    });
}
async function loadPageData(page) {
  if (authenticatedUser.role === "ADMIN_DALLOGIX") {
    await store.loadCompanies();
    if (["master-home", "error-logs"].includes(page)) {
      await store.loadErrorLogs();
      if (page === "error-logs") await store.loadTechnicalDiagnostics();
    }
    if (page === "company") {
      const id = queryId();
      if (!id) throw new Error("Empresa não informada.");
      store.selectCompany(id);
      await store.loadCompanyDetail();
    }
    if (page === "users") {
      store.state.selectedCompanyId =
        new URLSearchParams(window.location.search).get("company_id") || null;
      if (store.state.selectedCompanyId) await store.loadUsers();
    }
    if (page === "settings") {
      await Promise.all([
        store.loadConfiguration(),
        store.loadMonitoring(),
        store.loadEquipments(),
        store.loadSyncStatus(),
        store.loadDalaStatuses(),
      ]);
    }
    return;
  }
  const tasks = {
    dashboard: () => [
      store.loadDashboard(),
      store.loadMonitoring(),
      store.loadEquipments(),
      store.loadSyncStatus(),
      store.loadDalaStatuses(),
    ],
    manifests: () => [store.loadManifests()],
    manifest: () => [store.loadManifest(queryId())],
    "manifest-edit": () => [store.loadManifest(queryId()), store.loadProducts()],
    import: () => [store.loadProducts()],
    division: () => [
      store.loadManifest(queryId()),
      store.loadEquipments(),
      store.loadActiveLoading(),
    ],
    work: () => [
      store.loadActiveLoading().then(() => store.loadPendingReadings()),
      store.loadMonitoring(),
      store.loadEquipments(),
      store.loadManifests(),
    ],
    occurrences: () => [store.loadMonitoring(), store.loadActiveLoading()],
    summary: () => [store.loadMonitoring(), store.loadActiveLoading()],
    products: () => [store.loadProducts()],
    alerts: () => [
      store.loadMonitoring(),
      store.loadEquipments(),
      store.loadSyncStatus(),
    ],
    emergency: () => [store.loadActiveLoading(), store.loadMonitoring()],
    settings: () => [store.loadConfiguration(), store.loadMonitoring(), store.loadEquipments(), store.loadSyncStatus(), store.loadDalaStatuses()],
    dalas: () => [store.loadEquipments()],
    dala: () => [loadDalaView(queryId())],
    "dala-edit": () => [store.loadEquipment(queryId())],
    "error-logs": () => [store.loadErrorLogs(), store.loadTechnicalDiagnostics(), store.loadDeadLetters()],
    users: () => [store.loadUsers()],
  };
  if (
    ["manifest", "manifest-edit", "division", "dala", "dala-edit"].includes(page) &&
    !queryId()
  )
    throw new Error("Registro não informado.");
  await Promise.all(tasks[page]?.() || []);
}

async function loadDalaView(id) {
  await store.loadEquipment(id);
  const results = await Promise.allSettled([
    store.loadMonitoring(),
    store.loadDalaCommandHistory(id),
  ]);
  results.forEach((result) => {
    if (result.status === "rejected") {
      logFrontend.aviso("dala.consulta-auxiliar", result.reason);
    }
  });
}

async function renderPage() {
  const root = el("#screen-root");
  const requestId = ++renderRequestId;
  api.beginNavigation();

  await ensureScreenStyles(currentPage);

  // Mantém a tela atual visível enquanto as consultas terminam. Exibir um
  // painel intermediário de carregamento a cada navegação fazia o operador
  // perder o contexto e criava uma troca visual desnecessária no WebView2.
  // A nova tela substitui a anterior apenas quando os dados necessários
  // estiverem prontos; erros continuam sendo mostrados no mesmo espaço.
  try {
    await loadPageData(currentPage);
    if (requestId !== renderRequestId) return;
    render();
  } catch (error) {
    if (requestId !== renderRequestId) return;
    const missingRecord = error?.message === "Registro não informado.";
    const returnPage = missingRecord
      ? ["manifest", "manifest-edit", "division"].includes(currentPage)
        ? "manifests"
        : ["dala", "dala-edit"].includes(currentPage)
          ? "dalas"
          : currentPage === "company"
            ? "companies"
            : null
      : ["manifest", "manifest-edit", "dala-edit", "company"].includes(currentPage)
        ? ["manifest", "manifest-edit"].includes(currentPage)
          ? "manifests"
          : currentPage === "company"
            ? "companies"
            : "dalas"
        : null;
    if (returnPage) {
      await navigate(
        returnPage,
        "",
        { replace: true },
      );
      return;
    }
    logFrontend.erro("tela.renderizacao", error);
    if (root)
      root.innerHTML = estadoErro("Não foi possível atualizar esta tela", error.message || "Verifique a conexão local e tente novamente.", { label: "Tentar novamente", acao: "reload-page", tom: "primary" });
    bindActions();
  }
}

async function bootstrap() {
  installInteractionGuards();
  installOfflineShell();
  currentPage = initialPage || pageFromPath();
  if (currentPage === "login") {
    if (window.location.search)
      window.history.replaceState(null, "", window.location.pathname);
    let loginMessage = "";
    try {
      loginMessage = sessionStorage.getItem("trace-login-message") || "";
      sessionStorage.removeItem("trace-login-message");
    } catch (storageError) {
      /* armazenamento indisponível */
    }
    try {
      await store.loadLocalActivation();
    } catch (error) {
      store.state.localActivation = { active: false };
    }
    renderLocalActivation(store.state.localActivation || { active: false });
    renderLogin(loginMessage);
    bindLocalActivationForm();
    bindLoginForm();
    return;
  }
  if (!screens[currentPage]) {
    window.location.replace(pagePath("login"));
    return;
  }
  const response = await api.fetch("/api/me.php");
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    try {
      sessionStorage.setItem(
        "trace-login-message",
        result.error || "O acesso ao sistema foi bloqueado.",
      );
    } catch (storageError) {
      /* armazenamento indisponível */
    }
    window.location.replace(pagePath("login"));
    return;
  }
  const result = await response.json();
  authenticatedUser = result.user;
  store.setUser(authenticatedUser);
  store.setCsrfToken(result.csrf_token);
  const requestedPage = resolveAuthorizedPage(currentPage, defaultPage());
  if (requestedPage !== currentPage) {
    currentPage = requestedPage;
    window.location.replace(pagePath(currentPage));
    return;
  }
  await waitForDocumentStyles();
  await renderPage();
  window.addEventListener("popstate", async () => {
    const page = pageFromPath();
    if (!screens[page] || !isAllowedPage(page)) {
      window.location.replace(pagePath(defaultPage()));
      return;
    }
    currentPage = page;
    await renderPage();
  });
}
bootstrap();
