import assert from "node:assert/strict";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";
import { ServicoAcoesDala } from "../interface/js/servicos/ServicoAcoesDala.js";

function criarServico(respostas) {
  const requisicoes = [];
  const estado = {};
  const api = {
    fetch: async (url, options = {}) => {
      requisicoes.push({ url, options });
      const resposta = respostas.shift();
      return new Response(JSON.stringify(resposta.body), {
        status: resposta.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
  const servico = new ServicoAcoesDala({
    api,
    state: estado,
    jsonHeaders: () => ({ "Content-Type": "application/json", "X-CSRF-Token": "csrf" }),
    jsonResponse: async (response, fallback) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || fallback);
      return result;
    },
  });
  return { servico, estado, requisicoes };
}

test("consulta ações usa URL codificada e atualiza o estado compartilhado", async () => {
  const config = { acoes: [{ id: 2 }], gatilhos: [], can_manage: true };
  const { servico, estado, requisicoes } = criarServico([{ body: { data: config } }]);

  const resultado = await servico.loadConfig("dala & 1");

  assert.equal(requisicoes[0].url, "/api/acoes_dala.php?equipment_id=dala+%26+1");
  assert.equal(requisicoes[0].options.method, undefined);
  assert.deepEqual(resultado, config);
  assert.strictEqual(resultado, estado.dalaActionConfig);
});

test("salvar ação mantém POST para inclusão e PATCH para edição", async (context) => {
  for (const caso of [
    { nome: "criação", payload: { nome: "Avisar operador" }, metodo: "POST" },
    { nome: "edição", payload: { id: 9, nome: "Avisar operador" }, metodo: "PATCH" },
  ]) {
    await context.test(caso.nome, async () => {
      const config = { acoes: [], gatilhos: [], can_manage: true };
      const { servico, requisicoes } = criarServico([
        { body: { data: { saved: true } } },
        { body: { data: config } },
      ]);

      await servico.saveAction(4, caso.payload);

      assert.equal(requisicoes[0].options.method, caso.metodo);
      assert.equal(requisicoes[0].url, "/api/acoes_dala.php?equipment_id=4");
      assert.deepEqual(JSON.parse(requisicoes[0].options.body), caso.payload);
      assert.equal(requisicoes[0].options.headers["X-CSRF-Token"], "csrf");
      assert.equal(requisicoes[1].url, "/api/acoes_dala.php?equipment_id=4");
    });
  }
});

test("ordenação e gatilho mantêm os contratos de payload existentes", async (context) => {
  const casos = [
    {
      nome: "ordenação",
      executar: (servico) => servico.reorderActions(4, [8, 3]),
      metodo: "PATCH",
      esperado: { action: "reorder", ids: [8, 3] },
    },
    {
      nome: "gatilho",
      executar: (servico) => servico.saveTrigger(4, { trigger: "emergency", enabled: true }),
      metodo: "PATCH",
      esperado: { action: "trigger", trigger: "emergency", enabled: true },
    },
  ];

  for (const caso of casos) {
    await context.test(caso.nome, async () => {
      const { servico, requisicoes } = criarServico([
        { body: { data: { saved: true } } },
        { body: { data: { acoes: [], gatilhos: [], can_manage: true } } },
      ]);

      await caso.executar(servico);

      assert.equal(requisicoes[0].options.method, caso.metodo);
      assert.deepEqual(JSON.parse(requisicoes[0].options.body), caso.esperado);
      assert.equal(requisicoes.length, 2);
    });
  }
});

test("exclusão usa o ID separado na query e não envia corpo", async () => {
  const { servico, requisicoes } = criarServico([
    { body: { data: { deleted: true } } },
    { body: { data: { acoes: [], gatilhos: [], can_manage: true } } },
  ]);

  await servico.deleteAction(4, "acao 9");

  assert.equal(requisicoes[0].url, "/api/acoes_dala.php?equipment_id=4&id=acao+9");
  assert.equal(requisicoes[0].options.method, "DELETE");
  assert.equal("body" in requisicoes[0].options, false);
});

test("falha da API impede a recarga e mantém visível a mensagem de erro", async () => {
  const { servico, requisicoes } = criarServico([
    { status: 500, body: { error: "Falha gravando gatilho." } },
  ]);

  await assert.rejects(
    servico.saveTrigger(4, { trigger: "emergency" }),
    /Falha gravando gatilho\./,
  );
  assert.equal(requisicoes.length, 1);
});

test("a fachada preserva os nomes e os argumentos usados pelas telas", async () => {
  const chamadas = [];
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.servicoAcoesDala = Object.fromEntries(
    ["loadConfig", "saveAction", "reorderActions", "deleteAction", "saveTrigger"]
      .map((metodo) => [metodo, (...argumentos) => {
        chamadas.push({ metodo, argumentos });
        return Promise.resolve(metodo);
      }]),
  );

  await armazenamento.loadDalaActionConfig(4);
  await armazenamento.saveDalaAction(4, { nome: "aviso" });
  await armazenamento.reorderDalaActions(4, [2, 1]);
  await armazenamento.deleteDalaAction(4, 2);
  await armazenamento.saveDalaTrigger(4, { trigger: "emergency" });

  assert.deepEqual(chamadas, [
    { metodo: "loadConfig", argumentos: [4] },
    { metodo: "saveAction", argumentos: [4, { nome: "aviso" }] },
    { metodo: "reorderActions", argumentos: [4, [2, 1]] },
    { metodo: "deleteAction", argumentos: [4, 2] },
    { metodo: "saveTrigger", argumentos: [4, { trigger: "emergency" }] },
  ]);
});
