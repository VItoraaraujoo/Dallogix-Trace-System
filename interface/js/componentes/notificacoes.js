const TIPOS = new Set(["sucesso", "informacao", "aviso", "erro"]);

function obterPilha() {
  let pilha = document.querySelector("#trace-notificacoes");
  if (pilha) return pilha;
  pilha = document.createElement("div");
  pilha.id = "trace-notificacoes";
  pilha.className = "trace-notificacoes";
  pilha.setAttribute("aria-live", "polite");
  pilha.setAttribute("aria-atomic", "false");
  document.body.append(pilha);
  return pilha;
}

function tipoDaMensagem(tipo, mensagem) {
  if (TIPOS.has(tipo)) return tipo;
  const texto = String(mensagem || "").toLowerCase();
  if (/erro|falha|não foi|nao foi|indisponível|indisponivel|expirou/.test(texto)) return "erro";
  if (/cuidado|aguarde|ocupado|bloquead/.test(texto)) return "aviso";
  return "informacao";
}

export function notificar(mensagem, tipo = "informacao", { duracao = 6000 } = {}) {
  const texto = String(mensagem || "").trim();
  if (!texto) return null;
  const item = document.createElement("div");
  item.className = `trace-notificacao trace-notificacao-${tipoDaMensagem(tipo, texto)}`;
  item.setAttribute("role", "status");
  const conteudo = document.createElement("span");
  conteudo.textContent = texto;
  const fechar = document.createElement("button");
  fechar.type = "button";
  fechar.className = "trace-notificacao-fechar";
  fechar.setAttribute("aria-label", "Fechar notificação");
  fechar.textContent = "×";
  fechar.addEventListener("click", () => item.remove(), { once: true });
  item.append(conteudo, fechar);
  obterPilha().append(item);
  if (duracao > 0) window.setTimeout(() => item.remove(), duracao);
  return item;
}

export function confirmarAcao(mensagem, { titulo = "Confirmação necessária", confirmar = "Confirmar", cancelar = "Cancelar" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "trace-modal-overlay";
    const modal = document.createElement("section");
    modal.className = "trace-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2");
    heading.id = `trace-modal-titulo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    modal.setAttribute("aria-labelledby", heading.id);
    heading.textContent = titulo;
    const text = document.createElement("p");
    text.textContent = String(mensagem || "");
    const actions = document.createElement("div");
    actions.className = "trace-modal-acoes";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "button ghost";
    cancel.textContent = cancelar;
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "button primary";
    accept.textContent = confirmar;
    actions.append(cancel, accept);
    modal.append(heading, text, actions);
    overlay.append(modal);
    document.body.append(overlay);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish(false);
      if (event.key === "Enter") finish(true);
    };
    cancel.addEventListener("click", () => finish(false), { once: true });
    accept.addEventListener("click", () => finish(true), { once: true });
    document.addEventListener("keydown", onKeyDown);
    accept.focus();
  });
}

export function solicitarTexto(
  mensagem,
  {
    titulo = "Informação necessária",
    confirmar = "Continuar",
    cancelar = "Cancelar",
    valorInicial = "",
    tipo = "text",
    multilinha = false,
    obrigatorio = false,
  } = {},
) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "trace-modal-overlay";
    const modal = document.createElement("section");
    modal.className = "trace-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2");
    heading.id = `trace-modal-titulo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    modal.setAttribute("aria-labelledby", heading.id);
    heading.textContent = titulo;
    const text = document.createElement("p");
    text.textContent = String(mensagem || "");
    const field = multilinha ? document.createElement("textarea") : document.createElement("input");
    field.className = "trace-modal-campo";
    if (!multilinha) field.type = tipo;
    field.value = String(valorInicial ?? "");
    field.required = obrigatorio;
    field.setAttribute("aria-label", titulo);
    if (multilinha) field.rows = 4;
    const actions = document.createElement("div");
    actions.className = "trace-modal-acoes";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "button ghost";
    cancel.textContent = cancelar;
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "button primary";
    accept.textContent = confirmar;
    actions.append(cancel, accept);
    modal.append(heading, text, field, actions);
    overlay.append(modal);
    document.body.append(overlay);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish(null);
      if (event.key === "Enter" && (multilinha ? event.ctrlKey : true)) {
        event.preventDefault();
        if (!obrigatorio || field.value.trim()) finish(field.value);
      }
    };
    cancel.addEventListener("click", () => finish(null), { once: true });
    accept.addEventListener("click", () => {
      if (obrigatorio && !field.value.trim()) {
        field.focus();
        return;
      }
      finish(field.value);
    }, { once: true });
    document.addEventListener("keydown", onKeyDown);
    field.focus();
    field.select?.();
  });
}
