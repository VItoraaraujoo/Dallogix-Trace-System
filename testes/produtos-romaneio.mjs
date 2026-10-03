import test from "node:test";
import assert from "node:assert/strict";
import { produtosDisponiveisParaRomaneio } from "../interface/js/funcoes/romaneio.js";
import { products as telaProdutos } from "../interface/telas/produtos/produtos.js";

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

test("tela de produtos concentra exclusão e status dentro da edição", () => {
  const html = telaProdutos({
    state: {
      productsLoaded: true,
      products: [{
        id: 7,
        name: "Produto inativo",
        code: "SKU-7",
        category: "Teste",
        active: 0,
        barcodes: "789",
      }],
      productSearch: "",
      productFormOpen: true,
      editingProductId: 7,
    },
  });
  assert.match(html, /data-action="toggle-product-active"/);
  assert.match(html, />Ativar produto</);
  assert.match(html, /data-action="delete-product-edit"/);
  assert.doesNotMatch(html, /data-action="delete-product"/);
});
