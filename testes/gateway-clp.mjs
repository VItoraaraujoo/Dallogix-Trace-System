import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nodes = JSON.parse(readFileSync(new URL("../integracoes/node-red/trace-clp-bridge.flow.json", import.meta.url)));
const gatewayService = readFileSync(new URL("../servidor/src/Aplicacao/ServicoGatewayClp.php", import.meta.url), "utf8");
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
  TRACE_PHYSICAL_CLP_ENABLED: "0",
  TRACE_IO_MAP_STATUS: "CONFIRMAR",
  TRACE_MODBUS_MAP_EQUIPMENT_ID: "0",
  TRACE_MODBUS_COIL_CONVEYOR_RUN: "",
  TRACE_MODBUS_COIL_REVERSAL: "",
  TRACE_MODBUS_COIL_EMERGENCY: "",
  TRACE_MODBUS_COIL_EMERGENCY_FEEDBACK: "",
};
const approvedPhysicalConfiguration = {
  ...configuration,
  TRACE_PHYSICAL_CLP_ENABLED: "1",
  TRACE_IO_MAP_STATUS: "APPROVED",
  TRACE_MODBUS_MAP_EQUIPMENT_ID: "5",
  TRACE_MODBUS_COIL_CONVEYOR_RUN: "2049",
  TRACE_MODBUS_COIL_REVERSAL: "2050",
  TRACE_MODBUS_COIL_EMERGENCY: "2051",
  TRACE_MODBUS_COIL_EMERGENCY_FEEDBACK: "17",
};
function runtime(values = configuration) {
  const state = new Map();
  const timers = new Map();
  const sent = [];
  let nextTimerId = 1;
  const fakeSetTimeout = (callback, delay) => {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  };
  const fakeClearTimeout = (id) => timers.delete(id);
  const node = { send: (messages) => sent.push(messages), error: () => {} };
  const call = (id, msg) => new Function(
    "msg", "env", "flow", "Buffer", "setTimeout", "clearTimeout", "node",
    byId.get(id).func,
  )(
    msg,
    { get: (key) => values[key] },
    { get: (key) => state.get(key), set: (key, value) => state.set(key, value) },
    Buffer,
    fakeSetTimeout,
    fakeClearTimeout,
    node,
  );
  call.pendingTimers = () => timers.size;
  call.pendingDelays = () => [...timers.values()].map((timer) => timer.delay);
  call.sent = sent;
  call.runTimers = () => {
    for (const [id, timer] of [...timers]) {
      if (!timers.delete(id)) continue;
      timer.callback();
    }
  };
  return call;
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
    payload: { data: { id: 91, carregamento_id: 17, command, loading_state: loadingState, reversal_command: "REVERSAO_DESATIVAR" } },
  };
}

test("consulta de comandos executa GET antes de interpretar a resposta", () => {
  const next = byId.get(byId.get("command-claim-build").wires[0][0]);
  assert.equal(next.type, "http request");
  assert.deepEqual(next.wires[0], ["command-claim-dispatch"]);
});

test("CLAIM serializa comandos por Dala e mantém a emergência prioritária", () => {
  assert.match(gatewayService, /SELECT id FROM equipamentos WHERE id = :equipment_id LIMIT 1 FOR UPDATE/);
  assert.match(gatewayService, /r\.command = 'EMERGENCIA' AND NOT EXISTS \([\s\S]*?processing\.command = 'EMERGENCIA'[\s\S]*?processing\.status = 'PROCESSANDO'/);
  assert.match(gatewayService, /r\.command <> 'EMERGENCIA' AND NOT EXISTS \([\s\S]*?processing\.status = 'PROCESSANDO'/);
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

function physicalRuntime(values = {}) {
  return runtime({ ...approvedPhysicalConfiguration, ...values });
}

test("iniciar e parar usam a bobina configurada com FC5", () => {
  const call = physicalRuntime();
  const start = physicalFrame(call, "INICIAR_CARREGAMENTO", "PREPARANDO").written;
  assert.equal(start.payload[7], 5);
  assert.equal(start.payload.readUInt16BE(8), 2049);
  assert.equal(start.payload.readUInt16BE(10), 0xff00);
  const stop = physicalFrame(call, "PAUSAR_CARREGAMENTO", "CARREGANDO").written;
  assert.equal(stop.payload.readUInt16BE(8), 2049);
  assert.equal(stop.payload.readUInt16BE(10), 0x0000);
});

test("reversão e emergência usam suas bobinas configuradas", () => {
  const call = physicalRuntime();
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

test("o mapa permite o endereço zero e usa exatamente os valores configurados", () => {
  const call = physicalRuntime({
    TRACE_MODBUS_COIL_CONVEYOR_RUN: "0",
    TRACE_MODBUS_COIL_REVERSAL: "1",
    TRACE_MODBUS_COIL_EMERGENCY: "2",
    TRACE_MODBUS_COIL_EMERGENCY_FEEDBACK: "3",
  });
  const written = physicalFrame(call, "INICIAR_CARREGAMENTO", "PREPARANDO").written;
  assert.equal(written.payload.readUInt16BE(8), 0);
});

test("escrita física fica bloqueada por padrão sem mapa aprovado", () => {
  const result = runtime()("command-safe-gate", physicalCommand("INICIAR_CARREGAMENTO", "PREPARANDO"));
  assert.equal(result[0], null);
  assert.equal(result[1].payload.status, "REJEITADO");
  assert.match(result[1].payload.message, /bloqueada/i);
  assert.match(result[1].payload.message, /nenhuma escrita foi executada/i);
});

test("mapa físico exige aprovação, saídas e retorno distintos e vínculo com a Dala", () => {
  const cases = [
    [{ TRACE_IO_MAP_STATUS: "CONFIRMAR" }, /sem aprovação explícita/i],
    [{ TRACE_MODBUS_COIL_REVERSAL: "" }, /incompleto/i],
    [{ TRACE_MODBUS_COIL_REVERSAL: "65536" }, /incompleto/i],
    [{ TRACE_MODBUS_COIL_EMERGENCY_FEEDBACK: "2051" }, /repetidas/i],
    [{ TRACE_MODBUS_MAP_EQUIPMENT_ID: "6" }, /não está vinculado/i],
  ];
  for (const [overrides, message] of cases) {
    const result = physicalRuntime(overrides)("command-safe-gate", physicalCommand("INICIAR_CARREGAMENTO", "PREPARANDO"));
    assert.equal(result[0], null);
    assert.equal(result[1].payload.status, "REJEITADO");
    assert.match(result[1].payload.message, message);
  }
});

test("início para frente exige reversão confirmada desligada", () => {
  for (const reversalCommand of ["REVERSAO_ATIVAR", null]) {
    const input = physicalCommand("INICIAR_CARREGAMENTO", "PAUSADO");
    input.payload.data.reversal_command = reversalCommand;
    const result = physicalRuntime()("command-safe-gate", input);
    assert.equal(result[0], null);
    assert.equal(result[1].payload.status, "REJEITADO");
    assert.match(result[1].payload.message, /reversão desligada/i);
  }
});

test("reversão só pode ser alterada com a esteira parada", () => {
  for (const command of ["REVERSAO_ATIVAR", "REVERSAO_DESATIVAR"]) {
    const result = physicalRuntime()("command-safe-gate", physicalCommand(command, "CARREGANDO"));
    assert.equal(result[0], null);
    assert.equal(result[1].payload.status, "REJEITADO");
    assert.match(result[1].payload.message, /esteira em movimento/i);
  }
});

test("emergência continua prioritária e aceita operação em movimento", () => {
  const emergency = physicalFrame(physicalRuntime(), "EMERGENCIA", "CARREGANDO").written;
  assert.equal(emergency.payload.readUInt16BE(8), 2051);
  assert.equal(emergency.payload.readUInt16BE(10), 0xff00);
});

test("eco FC5 válido conclui o pedido como aplicado", () => {
  const call = physicalRuntime();
  const { written } = physicalFrame(call, "INICIAR_CARREGAMENTO", "PREPARANDO");
  const completed = call("command-write-result", {
    ...written,
    payload: Buffer.from(written.payload),
    modbusStartedAt: Date.now(),
  });
  assert.equal(completed[0].payload.status, "APLICADO");
  assert.match(completed[0].payload.message, /bobina 2049 ligada/);
});

test("timeout do socket encerra em erro sem afirmar o estado físico", () => {
  const call = physicalRuntime();
  const { written } = physicalFrame(call, "INICIAR_CARREGAMENTO", "PREPARANDO");
  const failure = call("command-write-error", { ...written, modbusTimeout: true });
  assert.equal(failure.payload.status, "ERRO");
  assert.match(failure.payload.message, /5 segundos/);
  assert.match(failure.payload.message, /Estado físico não confirmado/);
});

test("timeout da leitura identifica o retorno da emergência pendente", () => {
  const call = runtime();
  const failure = call("command-write-error", {
    modbusTimeout: true,
    modbusTimeoutKey: "reset",
    commandResponse: { id: 91 },
    traceToken: "test-device-token",
  });
  assert.equal(failure.payload.status, "ERRO");
  assert.match(failure.payload.message, /retorno da emergência/);
});

test("escrita e retorno usam conexões TCP próprias com limite absoluto", () => {
  for (const [id, next] of [
    ["command-write-tcp", "command-write-result"],
    ["command-reset-read-tcp", "command-reset-read-result"],
  ]) {
    const node = byId.get(id);
    assert.equal(node.type, "function");
    assert.match(node.func, /global\.get\('traceCreateTcpSocket'\)/);
    assert.match(node.func, /setTimeout\([\s\S]*?5000\)/);
    assert.match(node.func, /socket\.destroy\(\)/);
    assert.deepEqual(node.wires, [[next]]);
  }
  assert.deepEqual(byId.get("command-write-frame").wires, [["command-write-tcp"]]);
  assert.deepEqual(byId.get("command-reset-read-frame").wires, [["command-reset-read-tcp"]]);
  assert.deepEqual(byId.get("command-write-catch").scope, ["command-write-tcp", "command-reset-read-tcp"]);
});

test("eco FC5 incorreto não confirma escrita", () => {
  const call = physicalRuntime();
  const { written } = physicalFrame(call, "REVERSAO_ATIVAR", "PAUSADO");
  const invalidEcho = Buffer.from(written.payload);
  invalidEcho.writeUInt16BE(99, 8);
  const completed = call("command-write-result", {
    ...written,
    payload: invalidEcho,
    modbusStartedAt: Date.now(),
  });
  assert.equal(completed[0].payload.status, "ERRO");
  assert.match(completed[0].payload.message, /não confirmou/i);
});

test("comando desconhecido é concluído como rejeitado sem escrita", () => {
  const result = runtime()("command-safe-gate", commandResponse("COMANDO_DESCONHECIDO", "EMERGENCIA"));
  assert.equal(result[0], null);
  assert.equal(result[1].payload.status, "REJEITADO");
  assert.match(result[1].payload.message, /sem definição no gateway Modbus/i);
});

test("liberação usa bobinas configuradas e só conclui após retorno em 0", () => {
  const call = physicalRuntime();
  const { written } = physicalFrame(call, "DESBLOQUEAR_MAQUINA", "EMERGENCIA");
  assert.equal(written.payload.readUInt16BE(8), 2051);
  assert.equal(written.payload.readUInt16BE(10), 0x0000);

  const echo = call("command-write-result", {
    ...written,
    payload: Buffer.from(written.payload),
    modbusStartedAt: Date.now(),
  });
  assert.equal(echo[0], null);
  assert.ok(echo[1]);

  const resetRead = call("command-reset-read-frame", echo[1]);
  assert.equal(resetRead.payload[7], 1);
  assert.equal(resetRead.payload.readUInt16BE(8), 17);
  const frame = Buffer.from([0, 0, 0, 0, 0, 4, 1, 1, 1, 0]);
  frame.writeUInt16BE(resetRead.modbusResetTransaction, 0);
  const released = call("command-reset-read-result", {
    ...resetRead,
    payload: frame,
    modbusResetStartedAt: Date.now(),
  });
  assert.equal(released.payload.status, "APLICADO");
  assert.match(released.payload.message, /retorno da bobina 17 em 0/);

  frame[9] = 1;
  const blocked = call("command-reset-read-result", {
    ...resetRead,
    payload: frame,
    modbusResetStartedAt: Date.now(),
  });
  assert.equal(blocked.payload.status, "ERRO");
  assert.match(blocked.payload.message, /continua bloqueada/);
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

test("modo central ignora o simulador e só segue com mapa físico aprovado", () => {
  const values = {
    ...approvedPhysicalConfiguration,
    TRACE_INSTALLATION_MODE: "central",
    TRACE_LOCAL_SIMULATION: "1",
    TRACE_SIMULATOR_ONLY_COMMANDS: "1",
  };
  const result = runtime(values)("command-safe-gate", physicalCommand("INICIAR_CARREGAMENTO", "PREPARANDO"));
  assert.ok(result[0]);
  assert.equal(result[1], null);
  assert.equal(result[0].commandMap.coil, 2049);
});
