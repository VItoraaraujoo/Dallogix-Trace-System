import assert from "node:assert/strict";
import test from "node:test";
import { checkGatewayHealth } from "../integracoes/node-red/healthcheck.mjs";

const response = (records, ok = true) => ({
  ok,
  json: async () => ({ data: records }),
});

test("Node-RED saudável exige confirmação Modbus recente da Dala", async () => {
  const options = {
    apiUrl: "http://nginx",
    deviceToken: "token-de-teste",
    simulation: false,
    listening: async () => true,
  };
  let requestedUrl;
  let sentToken;
  assert.equal(await checkGatewayHealth({
    ...options,
    fetchFn: async (url, init) => {
      requestedUrl = url.toString();
      sentToken = init.headers["X-Device-Token"];
      return response([{ modbus_recently_confirmed: 1 }]);
    },
  }), true);
  assert.equal(requestedUrl, "http://nginx/api/equipamentos_gateway.php");
  assert.equal(sentToken, "token-de-teste");
  for (const records of [[], [{ modbus_recently_confirmed: 0 }], [
    { modbus_recently_confirmed: 1 }, { modbus_recently_confirmed: 0 },
  ]]) {
    assert.equal(await checkGatewayHealth({
      ...options,
      fetchFn: async () => response(records),
    }), false);
  }
  assert.equal(await checkGatewayHealth({ ...options, listening: async () => false }), false);
  assert.equal(await checkGatewayHealth({ ...options, deviceToken: "" }), false);
  assert.equal(await checkGatewayHealth({ ...options, fetchFn: async () => response([], false) }), false);
  assert.equal(await checkGatewayHealth({ ...options, fetchFn: async () => { throw new Error("offline"); } }), false);
});

test("simulação verifica apenas o processo Node-RED", async () => {
  assert.equal(await checkGatewayHealth({
    simulation: true,
    listening: async () => true,
  }), true);
});
