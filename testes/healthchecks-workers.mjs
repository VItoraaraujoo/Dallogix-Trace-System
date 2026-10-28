import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createFfmpegArguments, createFfmpegInputList } from "../integracoes/camera-worker/ffmpeg-arguments.mjs";
import { boundedInteger } from "../integracoes/camera-worker/config.mjs";

const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const cameraWorker = readFileSync(new URL("../integracoes/camera-worker/camera-worker.mjs", import.meta.url), "utf8");
const cameraDockerfile = readFileSync(new URL("../integracoes/camera-worker/Dockerfile", import.meta.url), "utf8");
const cameraDockerignore = readFileSync(new URL("../integracoes/camera-worker/.dockerignore", import.meta.url), "utf8");
const syncWorker = readFileSync(new URL("../scripts/sync_worker.php", import.meta.url), "utf8");
const pruneImages = readFileSync(new URL("../scripts/prune_images.php", import.meta.url), "utf8");
const sensorEndpoint = readFileSync(new URL("../servidor/api/operacoes/sensor_eventos.php", import.meta.url), "utf8");
const readingsEndpoint = readFileSync(new URL("../servidor/api/operacoes/leituras.php", import.meta.url), "utf8");
const sensorFlow = JSON.parse(readFileSync(new URL("../integracoes/node-red/trace-clp-bridge.flow.json", import.meta.url), "utf8"));

test("worker da câmera fica saudável sem exigir processamento contínuo de imagem", () => {
  assert.match(compose, /health\?\.running === true && health\?\.capture_mode === 'ON_DEMAND'/);
});

test("FFmpeg captura um único quadro JPEG somente quando existe pedido", () => {
  const argumentsList = createFfmpegArguments();
  assert.deepEqual(argumentsList.slice(argumentsList.indexOf("-i"), argumentsList.indexOf("-i") + 2), ["-i", "/dev/stdin"]);
  assert.ok(!argumentsList.some((argument) => argument.includes("usuario") || argument.includes("senha")));
  assert.ok(argumentsList.includes("-protocol_whitelist"));
  assert.ok(argumentsList.includes("-safe"));
  assert.deepEqual(argumentsList.slice(argumentsList.indexOf("-frames:v"), argumentsList.indexOf("-frames:v") + 2), ["-frames:v", "1"]);
  assert.ok(!argumentsList.some((argument) => argument.startsWith("fps=")));
  assert.match(
    createFfmpegInputList("rtsp://usuario:senha@192.168.1.10/Streaming/channels/101"),
    /ffconcat version 1\.0\nfile 'rtsp:\/\/usuario:senha@192\.168\.1\.10\/Streaming\/channels\/101'\noption rtsp_transport tcp\n/,
  );
  assert.throws(() => createFfmpegInputList("rtsp://camera/\nfile '/tmp/malicioso'"), /quebra de linha/);
  assert.match(cameraWorker, /stdio: \["pipe", "pipe", "ignore"\]/);
  assert.match(cameraWorker, /child\.stdin\.end\(createFfmpegInputList\(streamUrl\(\)\), "utf8"\)/);
  assert.match(cameraWorker, /function captureSingleFrame\(\)/);
  assert.match(cameraWorker, /cameraTcpReachable && cameraConfigurationIsComplete\(\)/);
  assert.doesNotMatch(cameraWorker, /keepStreamConnected|frameIsFresh|CAMERA_OUTPUT_FPS/);
  assert.match(compose, /CAMERA_CAPTURE_TIMEOUT_MS: \$\{CAMERA_CAPTURE_TIMEOUT_MS:-10000\}/);
});

test("worker mantém os limites de configuração em um único validador", () => {
  assert.equal(boundedInteger(undefined, 200, 100, 5000), 200);
  assert.equal(boundedInteger("100", 200, 100, 5000), 100);
  assert.equal(boundedInteger("5000", 200, 100, 5000), 5000);
  assert.equal(boundedInteger("99", 200, 100, 5000), 200);
  assert.equal(boundedInteger("5001", 200, 100, 5000), 200);
  assert.equal(boundedInteger("inválido", 200, 100, 5000), 200);
  assert.ok(cameraWorker.includes("import { boundedInteger } from \"./config.mjs\""));
});

test("imagem da câmera inclui o coletor incremental de quadros usado pelo worker", () => {
  assert.match(cameraWorker, /import \{ JpegFrameCollector \} from "\.\/jpeg-frame-collector\.mjs"/);
  assert.match(cameraWorker, /collector\.pushLatest\(chunk\)/);
  assert.match(cameraWorker, /import \{ createFfmpegArguments, createFfmpegInputList \} from "\.\/ffmpeg-arguments\.mjs"/);
  assert.match(cameraDockerfile, /COPY .*camera-worker\.mjs config\.mjs evidence-pdf\.mjs evidence-store\.mjs ffmpeg-arguments\.mjs jpeg-frame-collector\.mjs \.\//);
  assert.match(cameraDockerignore, /!config\.mjs/);
  assert.match(cameraDockerignore, /!evidence-pdf\.mjs/);
  assert.match(cameraDockerignore, /!evidence-store\.mjs/);
  assert.match(cameraDockerignore, /!ffmpeg-arguments\.mjs/);
  assert.match(cameraDockerignore, /!jpeg-frame-collector\.mjs/);
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
  assert.match(readingsEndpoint, /ORDER BY s\.detected_at DESC, s\.id DESC/);
  assert.match(readingsEndpoint, /\$result === "SEM_LEITURA" &&\s*\$sensorEventId/);
});

test("sincronização e retenção renovam heartbeat só após sucesso", () => {
  assert.match(compose, /if php \/var\/www\/scripts\/sync_worker\.php; then php \/var\/www\/scripts\/write_heartbeat\.php \/tmp\/trace-sync-worker-heartbeat/);
  assert.match(compose, /if php \/var\/www\/scripts\/prune_images\.php && php \/var\/www\/scripts\/prune_operational_data\.php; then php \/var\/www\/scripts\/write_heartbeat\.php \/tmp\/trace-retention-heartbeat/);
  assert.match(syncWorker, /if \(\$summary\["failed"\] > 0/);
  assert.match(pruneImages, /if \(\$failed > 0\) \{[\s\S]*?exit\(1\);/);
});
