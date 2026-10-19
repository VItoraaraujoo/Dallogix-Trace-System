import assert from "node:assert/strict";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";
import { ServicoCarregamentoAtivo } from "../interface/js/servicos/ServicoCarregamentoAtivo.js";

function criarServico({ respostas = [], state = {} } = {}) {
  const chamadas = [];
  const estado = {
    loadingId: 7,
    selectedLoadingId: 7,
    emergency: false,
    operationalState: "AGUARDANDO",
    running: false,
    ...state,
  };
  let filaAtualizacao = Promise.resolve();
  const api = {
    fetch: async (url, options = {}) => {
      chamadas.push({ tipo: "requisicao", url, options });
      const resposta = respostas.shift();
      return new Response(JSON.stringify(resposta?.body || {}), {
        status: resposta?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
  const servico = new ServicoCarregamentoAtivo({
    api,
    state: estado,
    jsonHeaders: () => ({ "Content-Type": "application/json", "X-CSRF-Token": "csrf" }),
    jsonResponse: async (response, fallback) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || fallback);
      return result;
    },
    loadCommandStatus: async (id) => chamadas.push({ tipo: "comando", id }),
    loadEquipments: async (options) => chamadas.push({ tipo: "dalas", options }),
    loadSummaryMonitoring: async () => chamadas.push({ tipo: "resumo" }),
    hasPendingCommand: () => false,
    applyCommandIntent: () => {},
    getRefreshQueue: () => filaAtualizacao,
    setRefreshQueue: (fila) => { filaAtualizacao = fila; },
    applySnapshotFromStore: () => {},
    applyListFromStore: () => {},
  });
  servico.load = async (id = estado.selectedLoadingId) => {
    chamadas.push({ tipo: "carregamento", id });
  };
  return { servico, estado, chamadas };
}

test("preparação preserva payload, seleciona o carregamento e atualiza o estado ativo", async () => {
  const payload = { romaneio_id: 3, truck_id: 5, equipment_id: 8 };
  const { servico, estado, chamadas } = criarServico({
    respostas: [{ body: { data: { id: "17", state: "AGUARDANDO" } } }],
  });

  const resultado = await servico.prepareLoading(payload);

  assert.deepEqual(resultado, { id: "17", state: "AGUARDANDO" });
  assert.equal(estado.selectedLoadingId, 17);
  assert.deepEqual(chamadas, [
    {
      tipo: "requisicao",
      url: "/api/carregamentos.php",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf" },
        body: JSON.stringify(payload),
      },
    },
    { tipo: "carregamento", id: 17 },
  ]);
});

test("troca de Dala atualiza o cadastro e recarrega o mesmo carregamento", async () => {
  const { servico, chamadas } = criarServico({
    respostas: [{ body: { data: { id: 7, equipment_id: 9 } } }],
  });

  const resultado = await servico.reassignLoading("7", "9");

  assert.deepEqual(resultado, { id: 7, equipment_id: 9 });
  assert.deepEqual(chamadas, [
    {
      tipo: "requisicao",
      url: "/api/carregamentos.php",
      options: {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf" },
        body: JSON.stringify({ carregamento_id: 7, equipment_id: 9 }),
      },
    },
    { tipo: "dalas", options: { force: true } },
    { tipo: "carregamento", id: 7 },
  ]);
});

test("desbloqueio envia o carregamento ativo e atualiza seu estado após o ACK", async () => {
  const { servico, chamadas } = criarServico({
    state: { loadingId: 22, selectedLoadingId: 22, emergency: true },
    respostas: [{ body: { data: { unlocked: true } } }],
  });

  const resultado = await servico.unlockMachine();

  assert.deepEqual(resultado, { unlocked: true });
  assert.deepEqual(chamadas, [
    {
      tipo: "requisicao",
      url: "/api/desbloquear_maquina.php",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf" },
        body: JSON.stringify({ carregamento_id: 22 }),
      },
    },
    { tipo: "carregamento", id: 22 },
  ]);
});

test("conflito de desbloqueio recarrega o estado e diferencia já liberada de emergência ativa", async (context) => {
  await context.test("máquina já liberada", async () => {
    const { servico, estado } = criarServico({
      state: { loadingId: 22, emergency: true },
      respostas: [{ status: 409, body: { error: "A máquina já foi liberada." } }],
    });
    servico.load = async () => {
      estado.emergency = false;
      estado.operationalState = "AGUARDANDO";
    };

    assert.deepEqual(await servico.unlockMachine(), {
      alreadyUnlocked: true,
      state: "AGUARDANDO",
    });
  });

  await context.test("emergência continua ativa", async () => {
    const { servico } = criarServico({
      state: { loadingId: 22, emergency: true },
      respostas: [{ status: 409, body: { error: "Ainda em emergência." } }],
    });

    await assert.rejects(servico.unlockMachine(), /Ainda em emergência\./);
  });
});

test("finalização atualiza estado, resumo e disponibilidade das Dalas", async () => {
  const { servico, estado, chamadas } = criarServico({
    state: { loadingId: 22, operationalState: "FINALIZANDO", running: true },
    respostas: [{ body: { data: { state: "FINALIZADO" } } }],
  });

  await servico.finishLoading(22, "Conferido pelo operador");

  assert.equal(estado.operationalState, "FINALIZADO");
  assert.equal(estado.running, false);
  assert.deepEqual(chamadas, [
    {
      tipo: "requisicao",
      url: "/api/encerrar_carregamento.php",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf" },
        body: JSON.stringify({
          carregamento_id: 22,
          justification: "Conferido pelo operador",
        }),
      },
    },
    { tipo: "resumo" },
    { tipo: "dalas", options: { force: true } },
  ]);
});

test("operações sem carregamento são recusadas antes de chamar a API", async (context) => {
  await context.test("desbloqueio", async () => {
    const { servico, chamadas } = criarServico({ state: { loadingId: null } });
    await assert.rejects(servico.unlockMachine(), /Nenhum carregamento ativo encontrado/);
    assert.deepEqual(chamadas, []);
  });

  await context.test("finalização", async () => {
    const { servico, chamadas } = criarServico();
    await assert.rejects(servico.finishLoading(null), /Nenhum carregamento ativo encontrado/);
    assert.deepEqual(chamadas, []);
  });
});

test("a fachada mantém os métodos públicos e encaminha os dados ao serviço", async () => {
  const chamadas = [];
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = { loadingId: 22 };
  armazenamento.servicoCarregamentoAtivo = Object.fromEntries(
    ["prepareLoading", "reassignLoading", "unlockMachine", "finishLoading"]
      .map((metodo) => [metodo, (...argumentos) => {
        chamadas.push({ metodo, argumentos });
        return Promise.resolve(metodo);
      }]),
  );

  await armazenamento.prepareLoading({ romaneio_id: 3 });
  await armazenamento.reassignLoading(22, 9);
  await armazenamento.unlockMachine();
  await armazenamento.finishLoading("OK");

  assert.deepEqual(chamadas, [
    { metodo: "prepareLoading", argumentos: [{ romaneio_id: 3 }] },
    { metodo: "reassignLoading", argumentos: [22, 9] },
    { metodo: "unlockMachine", argumentos: [] },
    { metodo: "finishLoading", argumentos: [22, "OK"] },
  ]);
});
