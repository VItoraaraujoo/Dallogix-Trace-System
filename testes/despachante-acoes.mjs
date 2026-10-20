import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { criarDelegacaoAcoes, criarDespachanteAcoes } from "../interface/js/controladores/despachante-acoes.js";
import { criarTratadorAcoesInterface } from "../interface/js/controladores/acoes-interface.js";

function criarTratadores(overrides = {}) {
  return Object.fromEntries([
    "navegacao",
    "administracao",
    "operacional",
    "diagnostico",
    "relatorios",
    "cadastros",
    "interface",
  ].map((name) => [name, overrides[name] || (() => false)]));
}

function criarNode({ action = "acao", type = "button", page = "2", isBack = false } = {}) {
  return {
    dataset: { action, page },
    classList: { contains: (name) => name === "page-back" && isBack },
    getAttribute: (name) => name === "type" ? type : null,
    closest: () => ({ requestSubmit() { this.submitted = true; } }),
  };
}

function criarBase(overrides = {}) {
  const calls = [];
  return {
    calls,
    api: { fetch: async (...args) => calls.push(["fetch", ...args]) },
    store: { csrfToken: "csrf", setManifestPage: async () => {} },
    telas: {},
    navegar: async (...args) => calls.push(["navegar", ...args]),
    paginaPadrao: () => "dashboard",
    caminhoPagina: (page) => `/${page}`,
    renderPagina: async () => calls.push(["renderPagina"]),
    render: () => calls.push(["render"]),
    acoesDeFormulario: new Set(),
    notificar: (...args) => calls.push(["notificar", ...args]),
    tratadores: criarTratadores(),
    windowRef: { history: { length: 1, back: () => calls.push(["back"]) }, location: {} },
    ...overrides,
  };
}

test("o despachante mantém a prioridade e interrompe após uma ação tratada", async () => {
  const order = [];
  const options = criarBase({
    tratadores: criarTratadores({
      navegacao: () => { order.push("navegacao"); return false; },
      administracao: () => { order.push("administracao"); return false; },
      operacional: async () => { order.push("operacional"); return "concluido"; },
      diagnostico: () => { order.push("diagnostico"); return false; },
    }),
  });

  await criarDespachanteAcoes(options)(criarNode());

  assert.deepEqual(order, ["navegacao", "administracao", "operacional"]);
});

test("o menu alterna uma vez por clique delegado, sem handler duplicado na hidratação", () => {
  const originalDocument = globalThis.document;
  const classes = new Set();
  const shell = {
    classList: {
      contains: (name) => classes.has(name),
      toggle(name) {
        if (classes.has(name)) {
          classes.delete(name);
          return false;
        }
        classes.add(name);
        return true;
      },
    },
  };
  globalThis.document = { querySelector: () => shell };

  try {
    let clickHandler;
    const root = { addEventListener: (_type, handler) => { clickHandler = handler; } };
    const delegate = criarDelegacaoAcoes(root);
    const collapsedStates = [];
    const node = { dataset: { action: "toggle-menu" }, setAttribute() {} };
    const interfaceHandler = criarTratadorAcoesInterface({
      isMobileMenuViewport: () => false,
      setMobileMenuState: () => {},
      saveSidebarCollapsedPreference: (value) => collapsedStates.push(value),
    });
    delegate((target) => interfaceHandler(target.dataset.action, target));
    clickHandler({ target: { closest: () => node } });

    assert.equal(classes.has("sidebar-collapsed"), true);
    assert.deepEqual(collapsedStates, [true]);
    const application = readFileSync(new URL("../interface/js/aplicacao.js", import.meta.url), "utf8");
    assert.doesNotMatch(application, /menuToggle\.addEventListener\("click"/);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("a ação de formulário não duplica o submit do botão", async () => {
  let submitted = 0;
  const options = criarBase({ acoesDeFormulario: new Set(["salvar"]) });
  const dispatch = criarDespachanteAcoes(options);
  const node = criarNode({ action: "salvar" });
  node.closest = () => ({ requestSubmit: () => { submitted += 1; } });

  await dispatch(node);
  await dispatch(criarNode({ action: "salvar", type: "submit" }));

  assert.equal(submitted, 1);
  assert.deepEqual(options.calls, []);
});

test("a paginação atualiza a tela e apresenta falhas ao usuário", async () => {
  const options = criarBase();
  const dispatch = criarDespachanteAcoes(options);
  await dispatch(criarNode({ action: "manifest-page" }));
  assert.deepEqual(options.calls, [["render"]]);

  options.store.setManifestPage = async () => { throw new Error("Falha ao paginar"); };
  await dispatch(criarNode({ action: "manifest-page" }));
  assert.deepEqual(options.calls.at(-1), ["notificar", "Falha ao paginar"]);
});

test("logout envia o token CSRF e redireciona ao login", async () => {
  const options = criarBase();
  await criarDespachanteAcoes(options)(criarNode({ action: "logout" }));

  assert.deepEqual(options.calls[0], ["fetch", "/api/logout.php", {
    method: "POST",
    headers: { "X-CSRF-Token": "csrf" },
  }]);
  assert.equal(options.windowRef.location.href, "/login");
});

test("botão de voltar usa o histórico e a rota padrão quando necessário", async () => {
  const options = criarBase();
  const dispatch = criarDespachanteAcoes(options);
  const node = criarNode({ action: "", isBack: true });
  options.windowRef.history.length = 2;

  await dispatch(node);
  assert.deepEqual(options.calls, [["back"]]);

  options.calls.length = 0;
  options.windowRef.history.length = 1;
  await dispatch(node);
  assert.deepEqual(options.calls, [["navegar", "dashboard", "", { replace: true }]]);
});
