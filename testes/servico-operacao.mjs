import test from "node:test";
import assert from "node:assert/strict";
import { ServicoOperacao } from "../interface/js/servicos/ServicoOperacao.js";

test("serviço de operação encaminha iniciar e parar com o carregamento", async () => {
  const chamadas = [];
  const store = {
    state: { loadingId: 7 },
    requestMachineOperation: async (...args) => chamadas.push(args),
  };
  const servico = new ServicoOperacao(store);
  await servico.iniciar();
  await servico.parar();
  assert.deepEqual(chamadas, [
    ["INICIAR_CARREGAMENTO", 7],
    ["PAUSAR_CARREGAMENTO", 7],
  ]);
});

test("serviço de operação não envia reversão sem carregamento", async () => {
  const servico = new ServicoOperacao({ state: { loadingId: null } });
  await assert.rejects(() => servico.reversao(true), /Nenhum carregamento ativo/);
});

test("serviço de operação encaminha ligar e desligar reversão", async () => {
  const chamadas = [];
  const store = {
    state: { loadingId: 7 },
    requestMachineReverse: async (...args) => chamadas.push(args),
  };
  const servico = new ServicoOperacao(store);
  await servico.reversao(true);
  await servico.reversao(false);
  assert.deepEqual(chamadas, [
    [7, "REVERSAO_ATIVAR"],
    [7, "REVERSAO_DESATIVAR"],
  ]);
});
