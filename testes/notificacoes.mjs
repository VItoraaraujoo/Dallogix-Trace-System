import assert from "node:assert/strict";
import test from "node:test";
import { limparNotificacao, notificar } from "../interface/js/componentes/notificacoes.js";

test("avisos aparecem na página, escapam texto e podem ser fechados", () => {
  const elements = new Map();
  const content = {
    child: null,
    prepend(node) { this.child = node; elements.set(node.id, node); },
  };
  const makeElement = () => ({
    className: "",
    attributes: {},
    children: [],
    listeners: {},
    classList: { add() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    append(...children) { this.children.push(...children); },
    remove() { elements.delete(this.id); if (content.child === this) content.child = null; },
  });
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: (selector) => selector === ".content" ? content : null,
    getElementById: (id) => elements.get(id) || null,
    createElement: makeElement,
  };
  try {
    const warning = notificar("<falha>", "erro");
    assert.equal(warning.attributes.role, "alert");
    assert.equal(warning.children[0].textContent, "<falha>");
    assert.equal(content.child, warning);
    warning.children[1].listeners.click();
    assert.equal(content.child, null);
    const status = notificar("Pronto");
    assert.equal(status.attributes.role, "status");
    limparNotificacao();
    assert.equal(content.child, null);
  } finally {
    globalThis.document = previousDocument;
  }
});
