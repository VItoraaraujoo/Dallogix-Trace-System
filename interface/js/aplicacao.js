import { el, esc } from "./funcoes/html.js";
import { ArmazenamentoTrace } from "./classes/ArmazenamentoTrace.js";
import { FORM_ACTIONS } from "./constantes/acoes.js";
import { home } from "./telas/inicio.js";
import {
  manifests,
  importScreen,
  division,
  work,
  manifestView,
} from "./telas/operacoes.js";
import {
  occurrences,
  summary,
  history,
  tablet,
  products,
  alerts,
  emergency,
} from "./telas/monitoramento.js";
import { settings } from "./telas/configuracoes.js";
import { dashboard } from "./telas/painel.js";
import { dalas, dalaView, dalaEdit } from "./telas/dalas.js";
import { companies } from "./telas/empresas.js";
import { company } from "./telas/empresa.js";
import { users } from "./telas/usuarios.js";

const store = new ArmazenamentoTrace();
let renderRequestId = 0;
const screens = {
  // A Home antiga era uma segunda visão operacional. O escopo oficial tem uma
  // única entrada para isso: Operação por Dala.
  home: dashboard,
  dashboard,
  manifests,
  import: importScreen,
  division,
  work,
  occurrences,
  summary,
  history,
  tablet,
  products,
  alerts,
  emergency,
  settings,
  dalas,
  dala: dalaView,
  "dala-edit": dalaEdit,
  manifest: manifestView,
  companies,
  company,
  users,
};
const ROLE_PAGES = {
  ADMIN_DALLOGIX: ["companies", "company", "users"],
  ADMIN_EMPRESA: [
    "home",
    "dashboard",
    "manifests",
    "manifest",
    "import",
    "division",
    "work",
    "occurrences",
    "summary",
    "history",
    "tablet",
    "products",
    "alerts",
    "emergency",
    "settings",
    "dalas",
    "dala",
    "dala-edit",
    "users",
  ],
  SUPERVISOR: [
    "home",
    "dashboard",
    "manifests",
    "manifest",
    "import",
    "division",
    "work",
    "occurrences",
    "summary",
    "history",
    "tablet",
    "alerts",
    "emergency",
    "dala",
  ],
  USUARIO: [
    "home",
    "dashboard",
    "manifests",
    "manifest",
    "dala",
    "work",
    "summary",
    "occurrences",
    "tablet",
    "alerts",
    "emergency",
  ],
};
const NAV_GROUPS = [
  [
    "Operação",
    [
      ["manifests", "Romaneios"],
      ["dashboard", "Dashboard"],
    ],
  ],
  [
    "Cadastros",
    [
      ["products", "Produtos"],
      ["dalas", "Dalas"],
    ],
  ],
  [
    "Sistema",
    [
      ["settings", "Configurações"],
    ],
  ],
];
// Os arquivos HTML continuam acessíveis diretamente, mas, após o primeiro carregamento,
// as mudanças de tela usam o History API para não reiniciar toda a aplicação.
const initialPage =
  document.querySelector("script[data-page]")?.dataset.page || "";
let currentPage = initialPage;
let authenticatedUser = null;
let tabletTimer = null;
let workTimer = null;
let tabletPolling = false;
let workPolling = false;

function sidebarCollapsed() {
  try {
    return localStorage.getItem("trace-sidebar-collapsed") === "1";
  } catch (error) {
    return false;
  }
}
function allowedPages() {
  return ROLE_PAGES[authenticatedUser?.role] || [];
}
function defaultPage() {
  return authenticatedUser?.role === "ADMIN_DALLOGIX"
    ? "companies"
    : allowedPages().includes("dashboard")
      ? "dashboard"
      : "manifests";
}
function isAllowedPage(page) {
  return allowedPages().includes(page);
}
function pagePath(page, query = "") {
  return `${page}.html${query}`;
}
function pageFromPath(pathname = window.location.pathname) {
  const file = pathname.split("/").pop() || "index.html";
  return file === "index.html" ? "login" : file.replace(/\.html$/, "");
}
async function navigate(page, query = "", { replace = false } = {}) {
  if (!screens[page] || !isAllowedPage(page)) {
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
function queryReturnPage() {
  const page = new URLSearchParams(window.location.search).get("from");
  return ["dashboard", "dalas"].includes(page || "") ? page : "dalas";
}

function navigationIcon(page) {
  const icons = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/></svg>',
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
    history:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/></svg>',
    summary:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    alerts:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
    tablet:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/></svg>',
    companies:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5l8-3 8 3v16M4 10h16M8 7h.01M12 7h.01M16 7h.01M8 14h.01M12 14h.01M16 14h.01"/></svg>',
    users:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c.7-4 10.3-4 12 0M15 15c3.2-.4 5.3 1.1 6 3.2"/></svg>',
  };
  return icons[page] || icons.dashboard;
}

function renderLogin(message = "") {
  const box = el("#login-error");
  if (box) {
    box.setAttribute("role", "alert");
    box.innerHTML = message
      ? `<div class="login-error">${esc(message)}</div>`
      : "";
  }
}
function hydrateChrome() {
  const shell = document.getElementById("shell");
  if (shell && sidebarCollapsed()) shell.classList.add("sidebar-collapsed");
  const nav = document.querySelector(".sidebar nav");
  if (nav)
    nav.innerHTML = NAV_GROUPS.map(([group, items]) => {
      const permitted = items.filter(([page]) => isAllowedPage(page));
      if (!permitted.length) return "";
      return `<span class="nav-label">${esc(group)}</span>${permitted.map(([page, label]) => `<a class="nav-item${page === currentPage ? " active" : ""}${["dashboard", "dalas"].includes(page) ? " nav-section-end" : ""}" data-page="${page}" data-label="${esc(label)}" href="${pagePath(page)}"><span class="nav-icon">${navigationIcon(page)}</span><span class="nav-text">${esc(label)}</span></a>`).join("")}`;
    }).join("");
  el("#user-avatar").textContent = (authenticatedUser.name || "A")
    .slice(0, 1)
    .toUpperCase();
  el("#user-name").textContent = authenticatedUser.name || "";
  el("#user-role").textContent = authenticatedUser.role || "";
}
function render() {
  hydrateChrome();
  el("#screen-root").innerHTML = screens[currentPage](store);
  bindActions();
  bindForms();
  if (["dalas", "dala"].includes(currentPage)) checkDalaStatuses();
  if (currentPage === "tablet") startTabletPolling();
  else stopTabletPolling();
  if (currentPage === "work") startWorkPolling();
  else stopWorkPolling();
}
function stopTabletPolling() {
  if (tabletTimer) {
    window.clearInterval(tabletTimer);
    tabletTimer = null;
  }
}
function startTabletPolling() {
  if (tabletTimer) return;
  tabletTimer = window.setInterval(async () => {
    if (currentPage !== "tablet") {
      stopTabletPolling();
      return;
    }
    if (tabletPolling) return;
    tabletPolling = true;
    try {
      await Promise.all([store.loadActiveLoading(), store.loadMonitoring()]);
      render();
    } catch (error) {
      /* mantém o último estado visível */
    } finally {
      tabletPolling = false;
    }
  }, 1000);
}
function stopWorkPolling() {
  if (workTimer) {
    window.clearInterval(workTimer);
    workTimer = null;
  }
}
function startWorkPolling() {
  if (workTimer) return;
  workTimer = window.setInterval(async () => {
    if (currentPage !== "work") {
      stopWorkPolling();
      return;
    }
    if (workPolling) return;
    workPolling = true;
    try {
      await Promise.all([
        store.loadActiveLoading(store.state.selectedLoadingId),
        store.loadMonitoring(),
      ]);
      render();
    } catch (error) {
      /* mantém o último estado visível */
    } finally {
      workPolling = false;
    }
  }, 2000);
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
  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
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
function timedCommandConfirmation({
  title,
  message,
  confirmLabel = "Sim",
  timeout = 8,
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "command-confirm-overlay";
    overlay.innerHTML = `<section class="command-confirm" role="dialog" aria-modal="true" aria-labelledby="command-confirm-title">
      <span class="kicker">Confirmação obrigatória</span>
      <h2 id="command-confirm-title">${esc(title)}</h2>
      <p>${esc(message)}</p>
      <strong class="command-confirm-timer">Confirme em <span>${timeout}</span> s</strong>
      <div class="command-confirm-actions"><button class="button ghost" data-confirm="no" type="button">Não</button><button class="button primary" data-confirm="yes" type="button">${esc(confirmLabel)}</button></div>
    </section>`;
    document.body.appendChild(overlay);
    const timer = overlay.querySelector(".command-confirm-timer span");
    let remaining = timeout;
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      window.clearInterval(interval);
      overlay.remove();
      resolve(confirmed);
    };
    const interval = window.setInterval(() => {
      remaining -= 1;
      if (timer) timer.textContent = String(Math.max(remaining, 0));
      if (remaining <= 0) finish(false);
    }, 1000);
    overlay
      .querySelector('[data-confirm="yes"]')
      .addEventListener("click", () => finish(true));
    overlay
      .querySelector('[data-confirm="no"]')
      .addEventListener("click", () => finish(false));
  });
}
function itemRowHtml(selectedId = "", quantity = 1) {
  const products = store.state.products || [];
  return `<tr class="manifest-item"><td><select name="item_product"><option value="">Selecionar produto…</option>${products.map((product) => `<option value="${product.id}"${String(product.id) === String(selectedId) ? " selected" : ""}>${esc(product.name)}${product.code ? ` (${esc(product.code)})` : ""}</option>`).join("")}</select></td><td><input name="item_quantity" type="number" min="1" value="${Number(quantity) || 1}" /></td><td><button class="button ghost" data-action="remove-item" type="button">Remover</button></td></tr>`;
}
// Consulta o status Modbus de cada dala exibida e atualiza a célula/painel correspondente.
async function checkDalaStatuses() {
  const cells = document.querySelectorAll(".dala-status[data-equipment-id]");
  await Promise.all(
    [...cells].map(async (cell) => {
      const id = cell.dataset.equipmentId;
      try {
        const status = await store.checkEquipmentStatus(id);
        const tone = status.status === "ONLINE" ? "online" : "offline";
        cell.innerHTML = `<span class="status-dot ${tone}"></span>${esc(status.message || status.status)}`;
      } catch (error) {
        cell.innerHTML = `<span class="status-dot offline"></span>${esc(error.message)}`;
      }
    }),
  );
  const viewStatus = document.querySelector(
    "#dala-view-status[data-equipment-id]",
  );
  if (viewStatus) {
    try {
      const status = await store.checkEquipmentStatus(
        viewStatus.dataset.equipmentId,
      );
      const tone = status.status === "ONLINE" ? "online" : "offline";
      viewStatus.innerHTML = `<span class="status-dot ${tone}"></span>${esc(status.message || status.status)}`;
    } catch (error) {
      /* mantém mensagem de verificação */
    }
  }
}
function bindActions() {
  document.querySelectorAll("[data-action]").forEach((node) => {
    if (node.dataset.actionBound === "1") return;
    node.dataset.actionBound = "1";
    node.addEventListener("click", async () => {
      const action = node.dataset.action;
      if (FORM_ACTIONS.has(action)) {
        node.closest("form")?.requestSubmit();
        return;
      }
      if (action === "reload-page") {
        await renderPage();
        return;
      }
      if (action === "toggle-menu") {
        const shell = document.querySelector(".shell");
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
      if (action === "open-company") {
        navigate("company", `?id=${node.dataset.id}`);
        return;
      }
      if (action === "toggle-license") {
        const active = node.dataset.status === "ATIVA";
        const reason = active
          ? prompt("Motivo do bloqueio da licença:", "Inadimplência")
          : "Licença mensal regularizada";
        if (reason === null) return;
        const dueAt = active
          ? node.dataset.due || new Date().toISOString().slice(0, 10)
          : prompt("Nova data de vencimento (AAAA-MM-DD):", node.dataset.due || "") || "";
        if (!dueAt) return;
        try {
          await store.updateLicense({
            company_id: Number(node.dataset.id),
            status: active ? "BLOQUEADA" : "ATIVA",
            due_at: dueAt,
            blocked_reason: active ? reason : "",
          });
          render();
        } catch (error) {
          alert(error.message);
        }
        return;
      }
      if (action === "back-companies") {
        navigate("companies");
        return;
      }
      if (action === "back-settings") {
        navigate("settings");
        return;
      }
      if (action === "open-users") {
        navigate(
          "users",
          node.dataset.companyId ? `?company_id=${node.dataset.companyId}` : "",
        );
        return;
      }
      if (action === "toggle-user") {
        const active = node.dataset.active !== "1";
        if (
          !confirm(
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
          alert(error.message);
        }
        return;
      }
      if (action === "reset-user-password") {
        const password = prompt(
          `Nova senha para ${node.dataset.name} (mínimo 10 caracteres):`,
        );
        if (password === null) return;
        if (password.length < 10) {
          alert("A senha deve ter pelo menos 10 caracteres.");
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
          alert("Senha atualizada.");
          render();
        } catch (error) {
          alert(error.message);
        }
        return;
      }
      if (action === "logout") {
        await fetch("/api/logout.php", {
          method: "POST",
          headers: store.csrfToken ? { "X-CSRF-Token": store.csrfToken } : {},
        });
        window.location.href = "index.html";
        return;
      }
      if (action === "export-report") {
        downloadCsv(
          "dallogix-relatorio-operacional.csv",
          store.state.reportCsvRows || [],
        );
        return;
      }
      if (action === "retry-sync") {
        try {
          const result = await store.retrySync(node.dataset.id);
          alert(
            result?.reason ||
              (result?.processed ? "Evento enviado." : "Evento reprocessado."),
          );
          render();
        } catch (error) {
          alert(error.message);
        }
        return;
      }
      if (action === "goto-manifests") {
        navigate("manifests");
        return;
      }
      if (action === "goto-dalas") {
        navigate("dalas");
        return;
      }
      if (action === "new-manifest") {
        navigate("import");
        return;
      }
      if (action === "view-manifest") {
        navigate("manifest", `?id=${node.dataset.id}`);
        return;
      }
      if (action === "prepare-manifest") {
        navigate("division", `?id=${node.dataset.id}`);
        return;
      }
      if (action === "back-manifest") {
        navigate("manifest", `?id=${queryId()}`);
        return;
      }
      if (action === "resume-loading") {
        store.state.selectedLoadingId = Number(node.dataset.loadingId) || null;
        navigate("work");
        return;
      }
      if (action === "select-loading") {
        try {
          await store.loadActiveLoading(node.dataset.id);
          await store.loadMonitoring();
          render();
        } catch (error) {
          alert(error.message);
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
          alert("O resumo final ficará disponível quando a quantidade prevista for atingida.");
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
      if (action === "reload-dalas") {
        render();
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
      if (action === "delete-product") {
        if (!confirm(`Excluir o produto "${node.dataset.name}"?`)) return;
        try {
          const result = await store.deleteProduct(node.dataset.id);
          alert(
            result?.deactivated
              ? "Produto possui histórico vinculado e foi desativado."
              : "Produto excluído.",
          );
          render();
        } catch (error) {
          alert(error.message);
        }
        return;
      }
      if (action === "toggle-dala-form") {
        store.state.dalaFormOpen = !store.state.dalaFormOpen;
        render();
        return;
      }
      if (action === "delete-dala") {
        if (!confirm(`Excluir a dala "${node.dataset.name}"?`)) return;
        try {
          await store.deleteEquipment(node.dataset.id);
          alert("Dala excluída.");
          render();
        } catch (error) {
          alert(error.message);
        }
        return;
      }
      if (action === "start-machine" || action === "stop-machine") {
        if (
          action === "start-machine" &&
          !(await timedCommandConfirmation({
            title: "Iniciar carregamento?",
            message:
              "Confirme que a esteira está livre e pronta para carregar no sentido normal.",
          }))
        )
          return;
        try {
          await store.changeLoadingState(
            action === "start-machine" ? "CARREGANDO" : "PAUSADO",
            node.dataset.loadingId,
          );
          await Promise.all([
            store.loadMonitoring(),
            store.loadActiveLoading(),
            store.loadDashboard(),
          ]);
          render();
        } catch (error) {
          alert(error.message);
        }
        return;
      }
      if (action === "reverse-machine") {
        if (
          !(await timedCommandConfirmation({
            title: "Ativar reversão?",
            message:
              "A esteira precisa estar parada. O gateway só enviará o comando após validar os intertravamentos do CLP.",
          }))
        )
          return;
        try {
          const result = await store.requestMachineReverse(
            node.dataset.loadingId,
            "REVERSAO_ATIVAR",
          );
          alert(result.message);
          await store.loadMonitoring();
          render();
        } catch (error) {
          alert(error.message);
        }
        return;
      }
      if (action === "add-item") {
        const tbody = document.querySelector("#manifest-items tbody");
        if (tbody) tbody.insertAdjacentHTML("beforeend", itemRowHtml());
        return;
      }
      if (action === "remove-item") {
        const rows = document.querySelectorAll("#manifest-items tbody tr");
        if (rows.length > 1) node.closest("tr")?.remove();
        return;
      }
      if (screens[action]) navigate(action);
      else if (action === "run") {
        if (
          !(await timedCommandConfirmation({
            title: "Iniciar carregamento?",
            message:
              "Confirme que a esteira está livre e pronta para carregar no sentido normal.",
          }))
        )
          return;
        try {
          await store.changeLoadingState("CARREGANDO");
          render();
        } catch (error) {
          alert(error.message);
        }
      } else if (action === "stop") {
        try {
          await store.changeLoadingState("PAUSADO");
          render();
        } catch (error) {
          alert(error.message);
        }
      } else if (action === "reverse-on" || action === "reverse-off") {
        if (store.state.operationalState !== "PAUSADO") {
          alert("Para alterar a reversão, pause a esteira primeiro.");
          return;
        }
        const activating = action === "reverse-on";
        if (
          !(await timedCommandConfirmation({
            title: activating ? "Ativar reversão?" : "Desativar reversão?",
            message:
              "O gateway só enviará o comando após validar os intertravamentos do CLP.",
            confirmLabel: activating ? "Ativar" : "Desativar",
          }))
        )
          return;
        try {
          const result = await store.requestMachineReverse(
            store.state.loadingId,
            activating ? "REVERSAO_ATIVAR" : "REVERSAO_DESATIVAR",
          );
          alert(result.message);
          render();
        } catch (error) {
          alert(error.message);
        }
      } else if (action === "emergency") {
        try {
          await store.changeLoadingState("EMERGENCIA");
          store.activateEmergency();
          render();
        } catch (error) {
          alert(error.message);
        }
      } else if (action === "unlock") {
        node.disabled = true;
        try {
          const result = await store.unlockMachine();
          alert(
            result?.alreadyUnlocked
              ? "A emergência já havia sido liberada. O estado atual foi atualizado."
              : "Emergência liberada. A máquina permanece em preparação até o próximo comando seguro.",
          );
          await navigate("work");
          render();
        } catch (error) {
          alert(error.message);
        } finally {
          node.disabled = false;
        }
      } else if (action === "finish") {
        try {
          const justification =
            store.state.loaded < store.state.planned
              ? prompt("Justificativa obrigatória para finalizar com divergência:") || ""
              : "";
          if (store.state.loaded < store.state.planned && !justification.trim()) return;
          await store.finishLoading(justification.trim());
          alert("Carregamento finalizado.");
          render();
        } catch (error) {
          alert(error.message);
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
      const response = await fetch("/api/login.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.authenticated !== true) {
        renderLogin(result.error || "E-mail ou senha inválidos.");
        return;
      }
      authenticatedUser = result.user;
      store.setUser(authenticatedUser);
      store.setCsrfToken(result.csrf_token);
      window.location.replace(pagePath(defaultPage()));
    } catch (error) {
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
function bindForms() {
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
        alert(error.message);
      }
    });
  // Rede do cliente: preserva os parâmetros de PDF já salvos.
  const networkForm = document.querySelector("#network-form");
  if (networkForm)
    networkForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(networkForm));
      const saved = store.state.configuration?.settings || {};
      try {
        await store.saveConfiguration({
          gateway_public_ip: raw.gateway_public_ip,
          sync_remote_url: raw.sync_remote_url,
          pdf_field_mapping: saved.pdf_field_mapping || {},
          pdf_search_field: saved.pdf_search_field || "barcode",
        });
        alert("Configuração salva.");
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  // Parâmetros da importação PDF: preserva a rede já salva.
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
          sync_remote_url: saved.sync_remote_url || "",
          pdf_field_mapping,
          pdf_search_field: raw.pdf_search_field,
        });
        alert("Parâmetros salvos.");
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  const productForm = document.querySelector("#product-form");
  if (productForm)
    productForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(productForm));
      const editingId = productForm.dataset.editing;
      try {
        if (editingId) {
          await store.updateProduct({ id: editingId, ...raw });
          alert("Produto atualizado.");
        } else {
          await store.createProduct(raw);
          alert("Produto cadastrado.");
        }
        store.state.productFormOpen = false;
        store.state.editingProductId = null;
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  const dalaCreateForm = document.querySelector("#dala-create-form");
  if (dalaCreateForm)
    dalaCreateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await store.createEquipment(
          Object.fromEntries(new FormData(dalaCreateForm)),
        );
        alert("Dala cadastrada.");
        store.state.dalaFormOpen = false;
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  const dalaEditForm = document.querySelector("#dala-edit-form");
  if (dalaEditForm)
    dalaEditForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(dalaEditForm));
      try {
        await store.updateEquipment({ id: dalaEditForm.dataset.id, ...raw });
        alert("Dala atualizada.");
        navigate(
          "dala",
          `?id=${dalaEditForm.dataset.id}&from=${queryReturnPage()}`,
        );
      } catch (error) {
        alert(error.message);
      }
    });
  const manifestForm = document.querySelector("#new-manifest-form");
  if (manifestForm)
    manifestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(manifestForm));
      const items = [...document.querySelectorAll("#manifest-items tbody tr")]
        .map((row) => ({
          product_id: row.querySelector('[name="item_product"]')?.value,
          quantity: row.querySelector('[name="item_quantity"]')?.value,
        }))
        .filter((item) => item.product_id && Number(item.quantity) >= 1);
      if (!items.length) {
        alert("Adicione ao menos um item com produto e quantidade.");
        return;
      }
      try {
        await store.createManifest({
          number: raw.number,
          scheduled_date: raw.scheduled_date || undefined,
          plate: raw.plate,
          expedidor: raw.expedidor,
          driver_name: raw.driver_name,
          items,
        });
        alert("Romaneio cadastrado.");
        navigate("manifests");
      } catch (error) {
        alert(error.message);
      }
    });
  // Importação PDF: preenche o formulário manual com os campos extraídos.
  const pdfForm = document.querySelector("#pdf-form");
  if (pdfForm)
    pdfForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const buttonNode = pdfForm.querySelector("button.button");
      if (buttonNode) buttonNode.disabled = true;
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
              itemRowHtml(data.product.id, fields.quantidade_numero),
            );
          }
        }
        const missing = data.missing || [];
        alert(
          `PDF importado.${missing.length ? ` Campos não encontrados: ${missing.join(", ")}.` : " Confira os dados e salve."}`,
        );
      } catch (error) {
        alert(error.message);
      } finally {
        if (buttonNode) buttonNode.disabled = false;
      }
    });
  const csvForm = document.querySelector("#csv-form");
  if (csvForm)
    csvForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await fetch("/api/importar_csv.php", {
        method: "POST",
        headers: store.csrfToken ? { "X-CSRF-Token": store.csrfToken } : {},
        body: new FormData(csvForm),
      });
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Falha ao importar CSV.");
        return;
      }
      await store.loadManifests();
      alert(
        `${result.data.romaneios} romaneio(s), ${result.data.items} item(ns) consolidados em ${result.data.linhas} linha(s) importada(s).`,
      );
      navigate("manifests");
    });
  const prepareLoadingForm = document.querySelector("#prepare-loading-form");
  if (prepareLoadingForm)
    prepareLoadingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = prepareLoadingForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const raw = Object.fromEntries(new FormData(prepareLoadingForm));
        const result = await store.prepareLoading({
          romaneio_id: queryId(),
          truck_id: raw.truck_id,
          equipment_id: raw.equipment_id,
        });
        alert(
          `Operação #${result.id} preparada. Confirme as condições físicas antes de iniciar a esteira.`,
        );
        await navigate("work");
      } catch (error) {
        alert(error.message);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  document.querySelectorAll(".manual-reading-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const raw = Object.fromEntries(new FormData(form));
        const result = await store.identifyReading(form.dataset.readingId, raw.barcode);
        alert(`Leitura identificada como ${result.result}.`);
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  });
  const userForm = document.querySelector("#user-create-form");
  if (userForm)
    userForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await store.createUser(Object.fromEntries(new FormData(userForm)));
        userForm.reset();
        await store.loadUsers();
        render();
        alert("Login criado.");
      } catch (error) {
        alert(error.message);
      }
    });
  const companyForm = document.querySelector("#company-create-form");
  if (companyForm)
    companyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await store.createCompany(
          Object.fromEntries(new FormData(companyForm)),
        );
        companyForm.reset();
        await store.loadCompanies();
        render();
        alert("Empresa criada. Agora crie o login de administrador.");
      } catch (error) {
        alert(error.message);
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
        alert(error.message);
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
  const reportFilters = document.querySelector("#report-filters");
  if (reportFilters)
    reportFilters.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await store.applyReportFilters(
          Object.fromEntries(new FormData(reportFilters)),
        );
        render();
      } catch (error) {
        alert(error.message);
      }
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
    if (page === "settings") await store.loadConfiguration();
    return;
  }
  const tasks = {
    home: [store.loadActiveLoading(), store.loadMonitoring()],
    dashboard: [
      store.loadDashboard(),
      store.loadMonitoring(),
      store.loadEquipments(),
    ],
    manifests: [store.loadManifests()],
    manifest: [store.loadManifest(queryId())],
    import: [store.loadProducts()],
    division: [
      store.loadManifest(queryId()),
      store.loadEquipments(),
      store.loadActiveLoading(),
    ],
      work: [
      store.loadActiveLoading(),
      store.loadMonitoring(),
      store.loadEquipments(),
      store.loadManifests(),
      store.loadPendingReadings(),
      ],
    occurrences: [store.loadMonitoring(), store.loadActiveLoading()],
    summary: [store.loadMonitoring(), store.loadActiveLoading()],
    history: [store.loadMonitoring(), store.loadReport()],
    tablet: [store.loadMonitoring(), store.loadActiveLoading()],
    products: [store.loadProducts()],
    alerts: [
      store.loadMonitoring(),
      store.loadEquipments(),
      store.loadSyncStatus(),
    ],
    emergency: [store.loadActiveLoading(), store.loadMonitoring()],
    settings: [store.loadConfiguration(), store.loadEquipments()],
    dalas: [store.loadEquipments()],
    dala: [store.loadEquipment(queryId()), store.loadMonitoring()],
    "dala-edit": [store.loadEquipment(queryId())],
    users: [store.loadUsers()],
  };
  if (
    ["manifest", "division", "dala", "dala-edit"].includes(page) &&
    !queryId()
  )
    throw new Error("Registro não informado.");
  await Promise.all(tasks[page] || []);
}

async function renderPage() {
  const root = el("#screen-root");
  const requestId = ++renderRequestId;

  // A navegação não fica bloqueada pelas APIs. A tela abre com o estado local
  // disponível e recebe os dados atualizados assim que cada consulta termina.
  if (root) {
    try {
      render();
    } catch (error) {
      root.innerHTML =
        '<div class="panel page-loading" role="status">Abrindo tela…</div>';
    }
  }
  try {
    await loadPageData(currentPage);
    if (requestId !== renderRequestId) return;
    render();
  } catch (error) {
    if (requestId !== renderRequestId) return;
    console.error(error);
    if (["manifest", "dala", "dala-edit", "company"].includes(currentPage)) {
      await navigate(
        currentPage === "manifest"
          ? "manifests"
          : currentPage === "company"
            ? "companies"
            : "dalas",
        "",
        { replace: true },
      );
      return;
    }
    if (root)
      root.innerHTML = `<div class="panel page-error"><h2>Não foi possível atualizar esta tela</h2><p>${esc(error.message || "Verifique a conexão local e tente novamente.")}</p><button class="button primary" data-action="reload-page" type="button">Tentar novamente</button></div>`;
    bindActions();
  }
}

async function bootstrap() {
  installInteractionGuards();
  currentPage = initialPage || pageFromPath();
  if (currentPage === "login") {
    if (window.location.search)
      window.history.replaceState(null, "", window.location.pathname);
    let response;
    try {
      response = await fetch("/api/me.php");
    } catch (error) {
      response = null;
    }
    if (response?.ok) {
      const result = await response.json();
      authenticatedUser = result.user;
      store.setUser(authenticatedUser);
      store.setCsrfToken(result.csrf_token);
      window.location.replace(pagePath(defaultPage()));
      return;
    }
    renderLogin();
    bindLoginForm();
    return;
  }
  if (!screens[currentPage]) {
    window.location.replace("index.html");
    return;
  }
  const response = await fetch("/api/me.php");
  if (!response.ok) {
    window.location.replace("index.html");
    return;
  }
  const result = await response.json();
  authenticatedUser = result.user;
  store.setUser(authenticatedUser);
  store.setCsrfToken(result.csrf_token);
  if (!isAllowedPage(currentPage)) {
    window.location.replace(pagePath(defaultPage()));
    return;
  }
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
