import assert from "node:assert/strict";
import test from "node:test";
import { criarRegistroTelas } from "../interface/js/controladores/registro-telas.js";

test("carrega só a tela pedida e reutiliza o renderizador", async () => {
  const carregadas = [];
  const registro = criarRegistroTelas({
    dashboard: async () => {
      carregadas.push("dashboard");
      return (store) => `dashboard:${store.id}`;
    },
    work: async () => {
      carregadas.push("work");
      return () => "work";
    },
  });

  assert.equal(registro.existe("dashboard"), true);
  assert.deepEqual(carregadas, []);
  await registro.carregar("dashboard");
  assert.deepEqual(carregadas, ["dashboard"]);
  assert.equal(registro.telas.dashboard({ id: 7 }), "dashboard:7");

  await registro.carregar("dashboard");
  assert.deepEqual(carregadas, ["dashboard"]);
  await assert.rejects(registro.carregar("unknown"), /Não existe tela registrada/);
});

test("requisições concorrentes compartilham o mesmo carregamento", async () => {
  let importacoes = 0;
  let concluirImportacao;
  const registro = criarRegistroTelas({
    settings: () => {
      importacoes += 1;
      return new Promise((resolve) => { concluirImportacao = resolve; });
    },
  });

  const primeira = registro.carregar("settings");
  const segunda = registro.carregar("settings");
  await Promise.resolve();
  assert.equal(importacoes, 1);
  concluirImportacao(() => "settings");
  await Promise.all([primeira, segunda]);
  assert.equal(registro.telas.settings({}), "settings");
});

test("falha de importação pode ser repetida sem prender a tela", async () => {
  let tentativas = 0;
  const registro = criarRegistroTelas({
    alerts: async () => {
      tentativas += 1;
      if (tentativas === 1) throw new Error("rede indisponível");
      return () => "alerts";
    },
  });

  await assert.rejects(registro.carregar("alerts"), /rede indisponível/);
  assert.throws(() => registro.telas.alerts({}), /ainda não foi carregada/);
  await registro.carregar("alerts");

  assert.equal(tentativas, 2);
  assert.equal(registro.telas.alerts({}), "alerts");
});
