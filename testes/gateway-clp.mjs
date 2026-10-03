import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nodes = JSON.parse(readFileSync(new URL("../integracoes/node-red/trace-clp-bridge.flow.json", import.meta.url)));
const byId = new Map(nodes.map((node) => [node.id, node]));
const configuration = {
  TRACE_API_URL: "http://api.local",
  TRACE_DEVICE_TOKEN: "test-device-token",
  TRACE_INSTALLATION_MODE: "local",
  TRACE_LOCAL_SIMULATION: "0",
  TRACE_SIMULATOR_ONLY_COMMANDS: "0",
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
function commandResponse(command, loadingState = "AGUARDANDO") {
  return {
    statusCode: 200,
    traceToken: "test-device-token",
    payload: { data: { id: 91, carregamento_id: 17, command, loading_state: loadingState } },
  };
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
test("instalação nova usa o perfil comprovado do sensor M2052", () => {
  const msg = runtime({ TRACE_API_URL: "http://api.local" })("modbus-frame", { modbusHost: "192.168.4.8", modbusPort: 502 });
  assert.equal(msg.payload[6], 1);
  assert.equal(msg.payload[7], 3);
  assert.equal(msg.payload.readUInt16BE(8), 2052);
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

test("fila de comandos preserva o destino físico da Dala", () => {
  const call = runtime();
  const result = call("command-claim-dispatch", {
    statusCode: 200,
    traceToken: "test-device-token",
    payload: { data: [{ id: 5, plc_connect_ip: "192.168.1.10", plc_port: 502, plc_protocol: "MODBUS_TCP" }] },
  });
  assert.equal(result[0][0].traceEquipment.plc_connect_ip, "192.168.1.10");
  assert.equal(result[0][0].modbusPort, 502);
  assert.equal(result[0][0].payload.action, "CLAIM");
});

function physicalCommand(command, loadingState) {
  return {
    ...commandResponse(command, loadingState),
    traceEquipment: { id: 5, plc_connect_ip: "192.168.1.10", plc_port: 502, plc_protocol: "MODBUS_TCP" },
    modbusHost: "192.168.1.10",
    modbusPort: 502,
    modbusUnit: 1,
  };
}

function physicalFrame(call, command, loadingState) {
  const gated = call("command-safe-gate", physicalCommand(command, loadingState));
  assert.ok(gated[0], `o comando ${command} deve seguir para escrita física`);
  assert.equal(gated[1], null);
  const written = call("command-write-frame", gated[0]);
  return { gated, written };
}

test("iniciar e parar escrevem M2049 com FC5", () => {
  const call = runtime();
  const start = physicalFrame(call, "INICIAR_CARREGAMENTO", "PREPARANDO").written;
  assert.equal(start.payload[7], 5);
  assert.equal(start.payload.readUInt16BE(8), 2049);
  assert.equal(start.payload.readUInt16BE(10), 0xff00);
  const stop = physicalFrame(call, "PAUSAR_CARREGAMENTO", "CARREGANDO").written;
  assert.equal(stop.payload.readUInt16BE(8), 2049);
  assert.equal(stop.payload.readUInt16BE(10), 0x0000);
});

test("reversão escreve M2050 e emergência escreve M2051", () => {
  const call = runtime();
  const reverse = physicalFrame(call, "REVERSAO_ATIVAR", "PAUSADO").written;
  assert.equal(reverse.payload.readUInt16BE(8), 2050);
  assert.equal(reverse.payload.readUInt16BE(10), 0xff00);
  const reverseOff = physicalFrame(call, "REVERSAO_DESATIVAR", "PAUSADO").written;
  assert.equal(reverseOff.payload.readUInt16BE(8), 2050);
  assert.equal(reverseOff.payload.readUInt16BE(10), 0x0000);
  const emergency = physicalFrame(call, "EMERGENCIA", "CARREGANDO").written;
  assert.equal(emergency.payload.readUInt16BE(8), 2051);
  assert.equal(emergency.payload.readUInt16BE(10), 0xff00);
});

test("eco FC5 válido conclui o pedido como aplicado", () => {
  const call = runtime();
  const { written } = physicalFrame(call, "INICIAR_CARREGAMENTO", "PREPARANDO");
  const completed = call("command-write-result", {
    ...written,
    payload: Buffer.from(written.payload),
    modbusStartedAt: Date.now(),
  });
  assert.equal(completed.payload.status, "APLICADO");
  assert.match(completed.payload.message, /M2049 ligada/);
});

test("eco FC5 incorreto não confirma escrita", () => {
  const call = runtime();
  const { written } = physicalFrame(call, "REVERSAO_ATIVAR", "PAUSADO");
  const invalidEcho = Buffer.from(written.payload);
  invalidEcho.writeUInt16BE(2049, 8);
  const completed = call("command-write-result", {
    ...written,
    payload: invalidEcho,
    modbusStartedAt: Date.now(),
  });
  assert.equal(completed.payload.status, "ERRO");
  assert.match(completed.payload.message, /não confirmou/i);
});

test("comando sem endereço confirmado é concluído como rejeitado sem escrita", () => {
  const result = runtime()("command-safe-gate", commandResponse("DESBLOQUEAR_MAQUINA", "EMERGENCIA"));
  assert.equal(result[0], null);
  assert.equal(result[1].payload.status, "REJEITADO");
  assert.match(result[1].payload.message, /sem endereço físico confirmado/i);
});

test("simulação isolada não envia FC5", () => {
  const values = {
    ...configuration,
    TRACE_LOCAL_SIMULATION: "1",
    TRACE_SIMULATOR_ONLY_COMMANDS: "1",
  };
  const result = runtime(values)("command-safe-gate", commandResponse("INICIAR_CARREGAMENTO", "PREPARANDO"));
  assert.equal(result[0], null);
  assert.equal(result[1].payload.status, "APLICADO");
  assert.match(result[1].payload.message, /Nenhuma escrita Modbus foi executada/);
});

test("modo central não habilita simulador para escapar do caminho físico", () => {
  const values = {
    ...configuration,
    TRACE_INSTALLATION_MODE: "central",
    TRACE_LOCAL_SIMULATION: "1",
    TRACE_SIMULATOR_ONLY_COMMANDS: "1",
  };
  const result = runtime(values)("command-safe-gate", physicalCommand("INICIAR_CARREGAMENTO", "PREPARANDO"));
  assert.ok(result[0]);
  assert.equal(result[1], null);
});
