import assert from "node:assert/strict";
import net from "node:net";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const flow = JSON.parse(readFileSync(new URL("../integracoes/node-red/trace-clp-bridge.flow.json", import.meta.url)));
const writeNode = flow.find((node) => node.id === "command-write-tcp");
const heartbeatNode = flow.find((node) => node.id === "modbus-request");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function execute(msg, createSocket, timeout = setTimeout) {
  let sentCount = 0;
  const result = new Promise((resolve, reject) => {
    const node = {
      send(output) {
        sentCount += 1;
        resolve(output);
      },
      error(error, errorMessage) {
        const failure = new Error(errorMessage?.error?.message || error?.message || String(error));
        failure.modbusTimeout = errorMessage?.modbusTimeout === true;
        reject(failure);
      },
    };
    new Function("msg", "global", "node", "setTimeout", "clearTimeout", "Buffer", writeNode.func)(
      msg,
      { get: (key) => key === "traceCreateTcpSocket" ? createSocket : undefined },
      node,
      timeout,
      clearTimeout,
      Buffer,
    );
  });
  return { result, sentCount: () => sentCount };
}

const requestFrame = Buffer.from([0, 42, 0, 0, 0, 6, 1, 5, 8, 1, 0xff, 0]);

test("sondas de heartbeat não se acumulam enquanto uma conexão aguarda resposta", () => {
  const frameNode = flow.find((node) => node.id === "modbus-frame");
  const resultNode = flow.find((node) => node.id === "modbus-result");
  const failedNode = flow.find((node) => node.id === "heartbeat-request-failed");
  const state = new Map();
  const flowContext = { get: (key) => state.get(key), set: (key, value) => state.set(key, value) };
  const environment = { get: () => undefined };
  const makeFrame = new Function("msg", "env", "flow", "Buffer", frameNode.func);
  const handleResult = new Function("msg", "env", "flow", "Buffer", resultNode.func);
  const handleFailure = new Function("msg", "flow", failedNode.func);
  const input = { equipmentId: 5, modbusHost: "127.0.0.1", modbusPort: 1502 };

  assert.ok(makeFrame({ ...input }, environment, flowContext, Buffer));
  assert.equal(makeFrame({ ...input }, environment, flowContext, Buffer), null);
  handleFailure({ ...input }, flowContext);
  assert.ok(makeFrame({ ...input }, environment, flowContext, Buffer));
  handleResult({ ...input, payload: Buffer.alloc(0) }, environment, flowContext, Buffer);
  assert.ok(makeFrame({ ...input }, environment, flowContext, Buffer));
  assert.equal(heartbeatNode.type, "function");
  assert.equal(heartbeatNode.func, writeNode.func);
  assert.deepEqual(flow.find((node) => node.id === "heartbeat-request-catch").scope, ["modbus-request"]);
});

test("Modbus TCP monta a resposta completa mesmo quando chega em partes", async () => {
  let received = Buffer.alloc(0);
  const server = net.createServer((client) => {
    client.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length < requestFrame.length) return;
      client.write(requestFrame.subarray(0, 5));
      setTimeout(() => client.write(requestFrame.subarray(5)), 5);
    });
  });
  const port = await listen(server);

  try {
    const message = { host: "127.0.0.1", port, payload: requestFrame };
    const { result } = execute(message, () => new net.Socket());
    const response = await result;
    assert.deepEqual(response.payload, requestFrame);
    assert.deepEqual(received, requestFrame);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("timeout absoluto fecha o socket e ignora qualquer resposta tardia", async () => {
  let clientSocket;
  let received = Buffer.alloc(0);
  let sentCount = 0;
  const server = net.createServer((client) => {
    clientSocket = client;
    client.on("data", (chunk) => { received = Buffer.concat([received, chunk]); });
  });
  const port = await listen(server);
  const acceleratedTimeout = (callback, delay) => {
    assert.equal(delay, 5000);
    return setTimeout(callback, 40);
  };

  try {
    const message = { host: "127.0.0.1", port, payload: requestFrame };
    const run = execute(message, () => new net.Socket(), acceleratedTimeout);
    const { result } = run;
    await assert.rejects(result, (error) => {
      assert.equal(error.modbusTimeout, true);
      assert.match(error.message, /5 segundos/);
      return true;
    });
    sentCount = run.sentCount();
    assert.deepEqual(received, requestFrame);
    assert.equal(sentCount, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(clientSocket.destroyed, true);
    clientSocket.write(requestFrame);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(run.sentCount(), 0);
  } finally {
    if (clientSocket && !clientSocket.destroyed) clientSocket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
