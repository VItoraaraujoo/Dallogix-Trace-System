import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nodes = JSON.parse(readFileSync(new URL("../integracoes/node-red/trace-clp-bridge.flow.json", import.meta.url)));
const byId = new Map(nodes.map((node) => [node.id, node]));
const configuration = {
  TRACE_API_URL: "http://api.local",
  TRACE_DEVICE_TOKEN: "test-device-token",
  TRACE_MODBUS_UNIT_ID: "7",
  TRACE_MODBUS_HEARTBEAT_FUNCTION: "4",
  TRACE_MODBUS_HEARTBEAT_REGISTER: "23",
};
function runtime(values = configuration) {
  const state = new Map();
  return (id, msg) => new Function("msg", "env", "flow", "Buffer", byId.get(id).func)(
    msg, { get: (key) => values[key] },
    { get: (key) => state.get(key), set: (key, value) => state.set(key, value) }, Buffer,
  );
}
function response(transaction = 42, unit = 7, fc = 4) {
  const frame = Buffer.from([0, 0, 0, 0, 0, 5, unit, fc, 2, 0, 12]);
  frame.writeUInt16BE(transaction, 0);
  return frame;
}
function resultMessage(frame) {
  return { payload: frame, equipmentId: 5, traceToken: "test-device-token", modbusHost: "192.168.4.8", modbusPort: 1502,
    modbusTransaction: 42, modbusUnit: 7, modbusFunction: 4, modbusRegister: 23, modbusStartedAt: Date.now() };
}

test("consulta de comandos executa GET antes de interpretar a resposta", () => {
  const next = byId.get(byId.get("command-claim-build").wires[0][0]);
  assert.equal(next.type, "http request");
  assert.deepEqual(next.wires[0], ["command-claim-dispatch"]);
});
test("PC industrial usa um token de CLP para sua única Dala", () => {
  const call = runtime();
  for (const id of ["heartbeat-build", "command-claim-build"]) {
    const msg = call(id, { payload: null });
    assert.equal(msg.traceToken, "test-device-token");
    assert.equal(msg.headers["X-Device-Token"], "test-device-token");
    assert.equal(msg.method, "GET");
  }
  const plural = { ...configuration, TRACE_DEVICE_TOKEN: "token-a,token-b" };
  assert.equal(runtime(plural)("heartbeat-build", {}), null);
  assert.equal(runtime(plural)("command-claim-build", {}), null);
});
test("sonda usa unidade, função e registrador explicitamente configurados", () => {
  const msg = runtime()("modbus-frame", { modbusHost: "192.168.4.8", modbusPort: 1502 });
  assert.equal(msg.payload[6], 7);
  assert.equal(msg.payload[7], 4);
  assert.equal(msg.payload.readUInt16BE(8), 23);
  assert.equal(msg.modbusTransaction, msg.payload.readUInt16BE(0));
});
test("sem mapa de leitura explícito nenhuma sonda é enviada", () => {
  assert.equal(runtime({ TRACE_API_URL: "http://api.local" })("modbus-frame", {}), null);
});
test("resposta correlacionada e completa produz ONLINE", () => {
  assert.equal(runtime()("modbus-result", resultMessage(response())).payload.status, "ONLINE");
});
for (const [name, change] of [
  ["transação diferente", (b) => b.writeUInt16BE(41, 0)],
  ["unidade diferente", (b) => { b[6] = 1; }],
  ["comprimento inconsistente", (b) => b.writeUInt16BE(6, 4)],
  ["protocolo diferente", (b) => b.writeUInt16BE(1, 2)],
  ["função diferente", (b) => { b[7] = 3; }],
]) {
  test(`não publica ONLINE com ${name}`, () => {
    const frame = response(); change(frame);
    const result = runtime()("modbus-result", resultMessage(frame));
    assert.notEqual(result?.payload?.status, "ONLINE");
  });
}
test("resposta atrasada não renova disponibilidade", () => {
  const msg = resultMessage(response()); msg.modbusStartedAt -= 10000;
  assert.notEqual(runtime()("modbus-result", msg)?.payload?.status, "ONLINE");
});
test("falha HTTP não é tratada como cadastro válido", () => {
  const msg = { statusCode: 500, traceToken: "test-device-token", payload: { data: [{ id: 5, plc_ip: "192.168.4.8", plc_port: 1502 }] } };
  const result = runtime()("heartbeat-dispatch", msg);
  assert.equal(result?.[0]?.length || 0, 0);
});
