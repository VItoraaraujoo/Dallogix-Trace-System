import assert from "node:assert/strict";
import test from "node:test";
import { validarCodigoBarras, validarDala, validarPortaTcp, validarProduto } from "../interface/js/utilitarios/Validadores.js";

test("valida uma Dala completa", () => {
  assert.equal(validarDala({ name: "Esteira 1", equipment_code: "esteira_1", plc_ip: "192.168.1.10", plc_port: "502" }), "");
  assert.match(validarDala({ name: "", equipment_code: "esteira_1", plc_ip: "192.168.1.10", plc_port: "502" }), /nome.*obrigatório/i);
  assert.match(validarDala({ name: "Esteira", equipment_code: "Esteira 1", plc_ip: "192.168.1.10", plc_port: "502" }), /identificador/i);
});

test("valida porta e endereço sem aceitar valores ambíguos", () => {
  assert.equal(validarPortaTcp("502"), "");
  assert.match(validarPortaTcp("70000"), /1 e 65535/);
  assert.match(validarDala({ name: "Dala", equipment_code: "dala", plc_ip: "10.0.0.1 com espaço", plc_port: "502" }), /endereço/i);
});

test("valida produto e código de barras", () => {
  assert.equal(validarProduto({ name: "Produto", barcode: "7898250782592" }), "");
  assert.equal(validarCodigoBarras("12345678"), "");
  assert.match(validarProduto({ name: "Produto", barcode: "abc" }), /código de barras/i);
});
