import assert from "node:assert/strict";
import test from "node:test";
import {
  limparLogsFrontend,
  listarLogsFrontend,
  registrarLogFrontend,
} from "../interface/js/utilitarios/LogFrontend.js";

test.beforeEach(() => limparLogsFrontend());

test("registra erro técnico sem expor credenciais", () => {
  const registro = registrarLogFrontend(
    "erro",
    "teste.api",
    Object.assign(new Error("Falha HTTP"), { code: "HTTP_500", status: 500 }),
    { tentativa: 1, token: "nao deve aparecer" },
    { agora: Date.parse("2026-10-06T04:00:00Z") },
  );
  assert.equal(registro.erro.codigo, "HTTP_500");
  assert.equal(registro.erro.status, 500);
  assert.equal(registro.detalhes.token, "[omitido]");
  assert.equal(listarLogsFrontend().length, 1);
});

test("suprime aviso repetido no intervalo configurado", () => {
  const instante = Date.parse("2026-10-06T04:00:00Z");
  const primeiro = registrarLogFrontend("aviso", "teste.rede", "indisponível", {}, { agora: instante });
  const repetido = registrarLogFrontend("aviso", "teste.rede", "indisponível", {}, { agora: instante + 1000 });
  const depois = registrarLogFrontend("aviso", "teste.rede", "indisponível", {}, { agora: instante + 16000 });
  assert.ok(primeiro);
  assert.equal(repetido, null);
  assert.ok(depois);
  assert.equal(listarLogsFrontend().length, 2);
});
