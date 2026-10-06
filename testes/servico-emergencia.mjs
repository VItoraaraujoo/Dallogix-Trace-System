import test from "node:test";
import assert from "node:assert/strict";
import { ServicoEmergencia } from "../interface/js/servicos/ServicoEmergencia.js";

test("emergência exige carregamento selecionado", async () => {
  const servico = new ServicoEmergencia({ state: { loadingId: null } });
  await assert.rejects(() => servico.solicitar(), /Nenhum carregamento ativo/);
});

test("serviço encaminha a solicitação ao armazenamento", async () => {
  const chamadas = [];
  const store = {
    state: { loadingId: 42 },
    requestMachineEmergency: async (id) => {
      chamadas.push(["solicitar", id]);
      return { status: "PENDENTE" };
    },
    unlockMachine: async () => {
      chamadas.push(["liberar"]);
      return { state: "PAUSADO" };
    },
  };
  const servico = new ServicoEmergencia(store);
  await servico.solicitar();
  await servico.liberar();
  assert.deepEqual(chamadas, [["solicitar", 42], ["liberar"]]);
});
