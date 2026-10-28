import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const keyenceWorker = readFileSync(new URL("../integracoes/keyence-worker/keyence-worker.mjs", import.meta.url), "utf8");
const keyenceFlow = readFileSync(new URL("../integracoes/node-red/trace-clp-bridge.flow.json", import.meta.url), "utf8");
const keyenceEndpoint = readFileSync(new URL("../servidor/api/keyence_worker.php", import.meta.url), "utf8");
const syncWorker = readFileSync(new URL("../scripts/sync_worker.php", import.meta.url), "utf8");
const pruneImages = readFileSync(new URL("../scripts/prune_images.php", import.meta.url), "utf8");
const sensorEndpoint = readFileSync(new URL("../servidor/api/operacoes/sensor_eventos.php", import.meta.url), "utf8");
const readingsEndpoint = readFileSync(new URL("../servidor/api/operacoes/leituras.php", import.meta.url), "utf8");
const sensorFlow = JSON.parse(readFileSync(new URL("../integracoes/node-red/trace-clp-bridge.flow.json", import.meta.url), "utf8"));

test("worker Keyence recebe código e imagem sem serviço de câmera RTSP", () => {
  assert.match(compose, /keyence-worker:[\s\S]*?profiles: \["keyence"\]/);
  assert.match(compose, /KEYENCE_IMAGE_RECEIVE_TIMEOUT_MS: \$\{KEYENCE_IMAGE_RECEIVE_TIMEOUT_MS:-6000\}/);
  assert.match(compose, /health\?\.running === true && health\?\.enabled === true/);
  assert.match(keyenceWorker, /createFtpReceiver/);
  assert.match(keyenceWorker, /\/api\/keyence_worker\.php/);
  assert.match(keyenceEndpoint, /require_device_token\(\["SCANNER"\]\)/);
  assert.match(keyenceFlow, /imagem de erro ao leitor por FTP/);
  assert.doesNotMatch(compose, /camera-worker|CAMERA_RTSP|CAMERA_DEVICE_TOKEN/);
});

test("sensor M2052 gera evento com retry idempotente e timeout de leitura", () => {
  const poll = sensorFlow.find((node) => node.id === "sensor-poll-tick");
  const result = sensorFlow.find((node) => node.id === "modbus-result");
  const eventHttp = sensorFlow.find((node) => node.id === "sensor-event-http");
  const retry = sensorFlow.find((node) => node.id === "sensor-event-retry");

  assert.equal(poll.repeat, "0.2");
  assert.match(result.func, /TRACE_SENSOR_SIGNAL_MODE/);
  assert.match(result.func, /event_uuid: eventUuid/);
  assert.match(result.func, /sensorEventAttempts: 0/);
  assert.deepEqual(eventHttp.wires, [[retry.id]]);
  assert.match(retry.func, /attempt >= 3/);
  assert.match(retry.func, /sensorEventPayload/);
  assert.match(sensorEndpoint, /FINALIZE_EXPIRED/);
  assert.match(sensorEndpoint, /'SEM_LEITURA'/);
  assert.match(readingsEndpoint, /ORDER BY s\.detected_at ASC, s\.id ASC/);
  assert.match(readingsEndpoint, /\$result === "SEM_LEITURA" &&\s*\$sensorEventId/);
});

test("sincronização e retenção renovam heartbeat só após sucesso", () => {
  assert.match(compose, /if php \/var\/www\/scripts\/sync_worker\.php; then php \/var\/www\/scripts\/write_heartbeat\.php \/tmp\/trace-sync-worker-heartbeat/);
  assert.match(compose, /if php \/var\/www\/scripts\/prune_images\.php && php \/var\/www\/scripts\/prune_operational_data\.php; then php \/var\/www\/scripts\/write_heartbeat\.php \/tmp\/trace-retention-heartbeat/);
  assert.match(syncWorker, /if \(\$summary\["failed"\] > 0/);
  assert.match(pruneImages, /if \(\$failed > 0\) \{[\s\S]*?exit\(1\);/);
});
