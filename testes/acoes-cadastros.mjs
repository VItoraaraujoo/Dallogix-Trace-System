import assert from "node:assert/strict";
import test from "node:test";
import { criarTratadorAcoesCadastros } from "../interface/js/controladores/acoes-cadastros.js";
import { criarDelegacaoAcoes } from "../interface/js/controladores/despachante-acoes.js";

test("remove-item remove somente a linha selecionada do romaneio", () => {
  let removals = 0;
  const handler = criarTratadorAcoesCadastros({
    store: { state: {} },
    render() {},
    notificar() {},
    confirmarAcao: async () => true,
    paginaAtual: () => "manifest-edit",
    criarLinhaItemRomaneio: () => "",
  });

  const handled = handler("remove-item", {
    closest(selector) {
      assert.equal(selector, "tr");
      return { remove: () => { removals += 1; } };
    },
  });

  assert.equal(handled, true);
  assert.equal(removals, 1);
});

test("o botão Remover criado depois do render também recebe o clique", () => {
  let clickListener;
  const root = {
    addEventListener(eventName, listener) {
      assert.equal(eventName, "click");
      clickListener = listener;
    },
  };
  let removals = 0;
  const row = { remove() { removals += 1; } };
  const button = {
    dataset: { action: "remove-item" },
    closest(selector) {
      assert.equal(selector, "tr");
      return row;
    },
  };
  const updateDispatcher = criarDelegacaoAcoes(root);
  let staleDispatcherCalls = 0;
  updateDispatcher(() => { staleDispatcherCalls += 1; });
  const handler = criarTratadorAcoesCadastros({
    store: { state: {} },
    render() {},
    notificar() {},
    confirmarAcao: async () => true,
    paginaAtual: () => "manifest-edit",
    criarLinhaItemRomaneio: () => "",
  });
  updateDispatcher((node) => handler(node.dataset.action, node));

  // Este botão representa a linha inserida após o listener global já existir.
  clickListener({ target: { closest: (selector) => selector === "[data-action]" ? button : null } });

  assert.equal(removals, 1);
  assert.equal(staleDispatcherCalls, 0);
});
