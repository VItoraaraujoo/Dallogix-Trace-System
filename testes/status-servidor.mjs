import assert from "node:assert/strict";
import test from "node:test";
import { statuses } from "../interface/js/funcoes/view.js";

test("status do servidor começa desconhecido sem health check", () => {
  const html = statuses({ state: { monitoring: { dispositivos: [] } } });
  assert.match(html, /Servidor <b class="status-value status-yellow"/);
  assert.match(html, />DESCONHECIDO<\/b>/);
  assert.doesNotMatch(html, /Servidor <b class="status-value status-green"/);
});

test("status do servidor fica confirmado somente após health check online", () => {
  const html = statuses({
    state: {
      serverStatus: "ONLINE",
      monitoring: { dispositivos: [] },
    },
  });
  assert.match(html, /Servidor <b class="status-value status-green"/);
  assert.match(html, />OK<\/b>/);
});

