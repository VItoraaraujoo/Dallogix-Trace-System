import assert from "node:assert/strict";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

test("um segundo comando não assume o bloqueio do primeiro", () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = { commandInFlight: false, commandInFlightToken: null };

  const primeiro = armazenamento.beginCommand();
  assert.ok(primeiro);
  assert.equal(armazenamento.beginCommand(), null);

  assert.equal(armazenamento.endCommand("token-antigo"), false);
  assert.equal(armazenamento.state.commandInFlight, true);
  assert.equal(armazenamento.endCommand(primeiro), true);
  assert.equal(armazenamento.state.commandInFlight, false);
});

test("um comando novo permanece protegido quando o anterior termina depois", () => {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.state = { commandInFlight: false, commandInFlightToken: null };

  const primeiro = armazenamento.beginCommand();
  armazenamento.endCommand(primeiro);
  const segundo = armazenamento.beginCommand();

  assert.ok(segundo);
  assert.equal(armazenamento.endCommand(primeiro), false);
  assert.equal(armazenamento.state.commandInFlight, true);
  armazenamento.endCommand(segundo);
});
