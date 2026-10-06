import assert from "node:assert/strict";
import test from "node:test";
import { prepararDialogoAcessivel } from "../interface/js/funcoes/dialogo.js";

function criarDocumentoFalso() {
  const ouvintes = new Map();
  const corpo = { focus() {}, contains: () => true };
  return {
    body: corpo,
    activeElement: corpo,
    contains: (elemento) => elemento?.conectado !== false,
    addEventListener(tipo, ouvinte) {
      ouvintes.set(tipo, ouvinte);
    },
    removeEventListener(tipo, ouvinte) {
      if (ouvintes.get(tipo) === ouvinte) ouvintes.delete(tipo);
    },
    emitir(tipo, evento) {
      ouvintes.get(tipo)?.(evento);
    },
  };
}

function criarElemento(documento, filhos = []) {
  return {
    conectado: true,
    filhos,
    atributos: new Map(),
    setAttribute(nome, valor) {
      this.atributos.set(nome, String(valor));
    },
    hasAttribute(nome) {
      return this.atributos.has(nome);
    },
    getAttribute(nome) {
      return this.atributos.get(nome) || null;
    },
    getClientRects() {
      return [{}];
    },
    querySelectorAll() {
      return this.filhos;
    },
    focus() {
      documento.activeElement = this;
    },
  };
}

test("diálogo confina Tab, fecha com Escape e devolve o foco", () => {
  const documentoAnterior = globalThis.document;
  const documento = criarDocumentoFalso();
  globalThis.document = documento;
  const acionador = criarElemento(documento);
  documento.activeElement = acionador;
  const primeiro = criarElemento(documento);
  const ultimo = criarElemento(documento);
  const modal = criarElemento(documento, [primeiro, ultimo]);
  let escapou = false;
  const controle = prepararDialogoAcessivel(modal, {
    focoInicial: primeiro,
    aoEscape: () => {
      escapou = true;
    },
  });

  assert.equal(documento.activeElement, primeiro);
  documento.activeElement = ultimo;
  const tab = { key: "Tab", shiftKey: false, preventDefault() { this.impediu = true; } };
  documento.emitir("keydown", tab);
  assert.equal(tab.impediu, true);
  assert.equal(documento.activeElement, primeiro);

  const escape = { key: "Escape", preventDefault() { this.impediu = true; } };
  documento.emitir("keydown", escape);
  assert.equal(escape.impediu, true);
  assert.equal(escapou, true);

  controle.desligar();
  controle.restaurarFoco();
  assert.equal(documento.activeElement, acionador);
  globalThis.document = documentoAnterior;
});
