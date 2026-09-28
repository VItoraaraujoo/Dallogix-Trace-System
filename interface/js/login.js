import {
  configurarSessaoPorAba,
  guardarTokenSessao,
} from "./sessao.js?v=202609222100";

configurarSessaoPorAba();

const DEFAULT_PAGE_BY_ROLE = Object.freeze({
  ADMIN_DALLOGIX: "master-home",
  ADMIN_EMPRESA: "dashboard",
  SUPERVISOR: "dashboard",
  USUARIO: "dashboard",
});

function renderLogin(message = "") {
  const box = document.querySelector("#login-error");
  if (!box) return;
  box.replaceChildren();
  box.setAttribute("role", "alert");
  box.setAttribute("aria-live", "assertive");
  if (!message) return;
  const error = document.createElement("div");
  error.className = "login-error";
  error.textContent = message;
  box.append(error);
  box.focus();
}

function renderLocalActivation(data = { active: false }, message = "") {
  const status = document.querySelector("#local-license-status");
  const panel = document.querySelector("#local-activation");
  const error = document.querySelector("#local-activation-error");
  const enabled = Boolean(data?.enabled);
  const licenseStatus = String(data?.license_status || (data?.active ? "ATIVA" : ""));
  const active = enabled && Boolean(data?.active) && licenseStatus === "ATIVA";
  const blocked = enabled && Boolean(data?.active) && licenseStatus !== "ATIVA";

  if (status) {
    status.replaceChildren();
    status.hidden = !active && !blocked;
    status.classList.toggle("is-blocked", blocked);
    if (active || blocked) {
      const title = document.createElement("strong");
      title.textContent = active ? "Licença ativa" : "Licença bloqueada";
      const detail = document.createElement("small");
      detail.textContent = active
        ? `${data.company_name || "Empresa configurada"} · @${data.login_domain || "—"}`
        : data.license_reason || "A empresa precisa ser liberada no servidor central.";
      status.append(title, detail);
    }
  }
  if (panel) panel.hidden = !enabled || active || blocked;
  if (error) {
    error.textContent = message;
    error.hidden = !message;
  }
}

async function loadLocalActivation() {
  const response = await fetch("/api/ativacao_local.php", { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível consultar a ativação local.");
  return result.data || { active: false };
}

async function activateLocalInstallation(payload) {
  const response = await fetch("/api/ativar_empresa.php", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível ativar esta instalação.");
  return result.data || { active: false };
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
    renderLocalActivation({ enabled: true, active: false });
    try {
      const data = Object.fromEntries(new FormData(form));
      const activation = await activateLocalInstallation(data);
      renderLocalActivation(activation);
      const login = document.querySelector('#login-form [name="email"]');
      if (login) login.value = data.email || "";
      form.reset();
      alert(`Instalação ativada para ${activation.company_name}.`);
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

function defaultPageForUser(user) {
  return DEFAULT_PAGE_BY_ROLE[String(user?.role || "").toUpperCase()] || "manifests";
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
      const response = await fetch("/api/login.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.authenticated !== true) {
        renderLogin(result.error || "Login ou senha inválidos.");
        return;
      }
      guardarTokenSessao(result.session_token);
      window.location.replace(`${defaultPageForUser(result.user)}.html`);
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

async function bootstrapLogin() {
  if (window.location.search) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  let loginMessage = "";
  try {
    loginMessage = sessionStorage.getItem("trace-login-message") || "";
    sessionStorage.removeItem("trace-login-message");
  } catch (storageError) {
    /* armazenamento indisponível */
  }
  let activation = { active: false };
  try {
    activation = await loadLocalActivation();
  } catch (error) {
    /* O login continua disponível se a consulta opcional de ativação falhar. */
  }
  renderLocalActivation(activation);
  renderLogin(loginMessage);
  bindLocalActivationForm();
  bindLoginForm();
}

bootstrapLogin();
