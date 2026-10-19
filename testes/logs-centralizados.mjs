import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { configurarTransporteLogs, limparLogsFrontend, logFrontend } from "../interface/js/utilitarios/LogFrontend.js";

test("avisos e erros do navegador são persistidos sem enviar informações sensíveis", async () => {
  const received = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  limparLogsFrontend();
  configurarTransporteLogs((record) => { received.push(record); });
  try {
    logFrontend.info("teste.info");
    logFrontend.aviso("teste.scanner", new Error("falha com Bearer token-secreto"), {
      authorization: "token-secreto",
      attempt: 2,
    });
    logFrontend.erro("teste.api", new Error("GET https://usuario:senha@trace.local/api?token=segredo"));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(received.length, 2);
    assert.equal(received[0].contexto, "teste.scanner");
    assert.match(received[0].erro.mensagem, /Bearer \[omitido\]/);
    assert.doesNotMatch(JSON.stringify(received), /token-secreto|senha@|token=segredo/);
  } finally {
    configurarTransporteLogs(null);
    limparLogsFrontend();
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("API aceita logs de cliente com CSRF, pagina consulta e expõe transições de dispositivo", () => {
  const endpoint = readFileSync(new URL("../servidor/api/monitoramento/logs_erros.php", import.meta.url), "utf8");
  const heartbeat = readFileSync(new URL("../servidor/api/dalas/device_heartbeat.php", import.meta.url), "utf8");
  assert.match(endpoint, /if \(\$method === "POST"\)/);
  assert.match(endpoint, /require_csrf\(\)/);
  assert.match(endpoint, /DATE_SUB\(NOW\(\), INTERVAL 15 SECOND\)/);
  assert.match(endpoint, /"pagination" => \["page"/);
  assert.match(endpoint, /"retention_days" => \$retentionDays/);
  assert.match(heartbeat, /in_array\(\$status, \["OFFLINE", "ERRO"\], true\)/);
  assert.match(heartbeat, /heartbeat\.dispositivo/);
  assert.match(heartbeat, /\$clpReportsAttachedSensor/);
  assert.match(heartbeat, /"device_type" => \$deviceType/);
});
