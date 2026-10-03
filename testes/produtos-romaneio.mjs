import test from "node:test";
import assert from "node:assert/strict";
import { produtosDisponiveisParaRomaneio } from "../interface/js/funcoes/romaneio.js";

const produtos = [
  { id: 1, name: "Produto ativo", active: 1 },
  { id: 2, name: "Produto inativo", active: 0 },
  { id: 3, name: "Produto ativo booleano", active: true },
];

test("novo romaneio oferece somente produtos ativos", () => {
  assert.deepEqual(
    produtosDisponiveisParaRomaneio(produtos).map((produto) => produto.id),
    [1, 3],
  );
});

test("edição preserva o produto inativo já gravado para permitir substituição", () => {
  assert.deepEqual(
    produtosDisponiveisParaRomaneio(produtos, "2").map((produto) => produto.id),
    [1, 2, 3],
  );
});
