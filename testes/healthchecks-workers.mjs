import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createFfmpegArguments, createFfmpegInputList } from "../integracoes/camera-worker/ffmpeg-arguments.mjs";
import { boundedInteger, CAMERA_OUTPUT_FPS_DEFAULT, CAMERA_OUTPUT_FPS_MAX, cameraOutputFps } from "../integracoes/camera-worker/config.mjs";

const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const cameraWorker = readFileSync(new URL("../integracoes/camera-worker/camera-worker.mjs", import.meta.url), "utf8");
const cameraDockerfile = readFileSync(new URL("../integracoes/camera-worker/Dockerfile", import.meta.url), "utf8");
const cameraDockerignore = readFileSync(new URL("../integracoes/camera-worker/.dockerignore", import.meta.url), "utf8");
const syncWorker = readFileSync(new URL("../scripts/sync_worker.php", import.meta.url), "utf8");
const pruneImages = readFileSync(new URL("../scripts/prune_images.php", import.meta.url), "utf8");

test("câmera só fica saudável depois de entregar quadro recente", () => {
  assert.match(compose, /health\?\.?stream_ready === true/);
});

test("câmera limita a codificação ao necessário para capturar quadro recente", () => {
  assert.equal(CAMERA_OUTPUT_FPS_DEFAULT, 5);
  assert.equal(CAMERA_OUTPUT_FPS_MAX, 5);
  assert.equal(cameraOutputFps(undefined), 5);
  assert.equal(cameraOutputFps("3"), 3);
  assert.equal(cameraOutputFps("15"), 5);
  assert.equal(cameraOutputFps("6"), 5);
  assert.equal(cameraOutputFps("2"), 5);
  assert.equal(cameraOutputFps("60"), 5);
  assert.ok(1000 / CAMERA_OUTPUT_FPS_DEFAULT < 750, "o intervalo padrão deve caber na janela de quadro recente");
  const argumentsList = createFfmpegArguments(5);
  assert.deepEqual(argumentsList.slice(argumentsList.indexOf("-i"), argumentsList.indexOf("-i") + 2), ["-i", "/dev/stdin"]);
  assert.ok(!argumentsList.some((argument) => argument.includes("usuario") || argument.includes("senha")));
  assert.ok(argumentsList.includes("-protocol_whitelist"));
  assert.ok(argumentsList.includes("-safe"));
  assert.match(
    createFfmpegInputList("rtsp://usuario:senha@192.168.1.10/Streaming/channels/101"),
    /ffconcat version 1\.0\nfile 'rtsp:\/\/usuario:senha@192\.168\.1\.10\/Streaming\/channels\/101'\noption rtsp_transport tcp\n/,
  );
  assert.throws(() => createFfmpegInputList("rtsp://camera/\nfile '/tmp/malicioso'"), /quebra de linha/);
  assert.ok(argumentsList.includes("fps=5"));
  assert.match(cameraWorker, /stdio: \["pipe", "pipe", "ignore"\]/);
  assert.match(cameraWorker, /child\.stdin\.end\(createFfmpegInputList\(streamUrl\(\)\), "utf8"\)/);
  assert.ok(cameraWorker.includes("output_fps: CAMERA_OUTPUT_FPS"));
  assert.match(compose, /CAMERA_OUTPUT_FPS: \$\{CAMERA_OUTPUT_FPS:-5\}/);
});

test("worker mantém limites de configuração em um helper único", () => {
  assert.equal(boundedInteger(undefined, 200, 100, 5000), 200);
  assert.equal(boundedInteger("100", 200, 100, 5000), 100);
  assert.equal(boundedInteger("5000", 200, 100, 5000), 5000);
  assert.equal(boundedInteger("99", 200, 100, 5000), 200);
  assert.equal(boundedInteger("5001", 200, 100, 5000), 200);
  assert.equal(boundedInteger("inválido", 200, 100, 5000), 200);
  assert.ok(cameraWorker.includes("import { boundedInteger, cameraOutputFps } from \"./config.mjs\""));
});

test("imagem da câmera inclui o coletor incremental de quadros usado pelo worker", () => {
  assert.match(cameraWorker, /import \{ JpegFrameCollector \} from "\.\/jpeg-frame-collector\.mjs"/);
  assert.match(cameraWorker, /collector\.pushLatest\(chunk\)/);
  assert.match(cameraWorker, /import \{ createFfmpegArguments, createFfmpegInputList \} from "\.\/ffmpeg-arguments\.mjs"/);
  assert.match(cameraDockerfile, /COPY .*camera-worker\.mjs config\.mjs ffmpeg-arguments\.mjs jpeg-frame-collector\.mjs \.\//);
  assert.match(cameraDockerignore, /!config\.mjs/);
  assert.match(cameraDockerignore, /!ffmpeg-arguments\.mjs/);
  assert.match(cameraDockerignore, /!jpeg-frame-collector\.mjs/);
});

test("sincronização e retenção renovam heartbeat só após sucesso", () => {
  assert.match(compose, /if php \/var\/www\/scripts\/sync_worker\.php; then php \/var\/www\/scripts\/write_heartbeat\.php \/tmp\/trace-sync-worker-heartbeat/);
  assert.match(compose, /if php \/var\/www\/scripts\/prune_images\.php && php \/var\/www\/scripts\/prune_operational_data\.php; then php \/var\/www\/scripts\/write_heartbeat\.php \/tmp\/trace-retention-heartbeat/);
  assert.match(syncWorker, /if \(\$summary\["failed"\] > 0/);
  assert.match(pruneImages, /if \(\$failed > 0\) \{[\s\S]*?exit\(1\);/);
});
