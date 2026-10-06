import assert from "node:assert/strict";
import test from "node:test";
import {
  paradaPodeSerEnfileiradaAposInicio,
  paradaPodeSubstituirInicio,
} from "../interface/telas/operacao/operacao.js";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

test("parada pode substituir um início ainda pendente em pausa", () => {
  assert.equal(
    paradaPodeSubstituirInicio({
      state: "PAUSADO",
      pendingStatus: "PENDENTE",
      pendingCommand: "INICIAR_CARREGAMENTO",
    }),
    true,
  );
});

test("parada não substitui início já reservado pelo gateway", () => {
  assert.equal(
    paradaPodeSubstituirInicio({
      state: "PAUSADO",
      pendingStatus: "PROCESSANDO",
      pendingCommand: "INICIAR_CARREGAMENTO",
    }),
    false,
  );
});

test("parada fica disponível atrás de início já reservado pelo gateway", () => {
  assert.equal(
    paradaPodeSerEnfileiradaAposInicio({
      state: "CARREGANDO",
      pendingStatus: "PROCESSANDO",
      pendingCommand: "INICIAR_CARREGAMENTO",
    }),
    true,
  );
});

test("consulta transitória sem comando preserva início pendente local", async () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  const pedido = {
    id: 42,
    command: "INICIAR_CARREGAMENTO",
    status: "PENDENTE",
  };
  armazenamento.state = { plcCommand: pedido };
  armazenamento.api = { fetch: async () => ({ ok: true }) };
  armazenamento.jsonResponse = async () => ({ data: null });

  const resultado = await armazenamento._loadPlcCommandStatus(7);

  assert.deepEqual(resultado, pedido);
  assert.deepEqual(armazenamento.state.plcCommand, pedido);
});
