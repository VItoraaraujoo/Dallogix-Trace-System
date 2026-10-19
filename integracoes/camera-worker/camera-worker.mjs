import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { boundedInteger, cameraOutputFps } from "./config.mjs";
import { createFfmpegArguments, createFfmpegInputList } from "./ffmpeg-arguments.mjs";
import { JpegFrameCollector } from "./jpeg-frame-collector.mjs";

const SERVICE_NAME = "camera-worker";
const API_BASE = (process.env.TRACE_API_URL || "http://nginx").replace(/\/+$/, "");
const DEVICE_TOKEN = process.env.CAMERA_DEVICE_TOKEN || "";
const CAMERA_HOST = process.env.CAMERA_RTSP_HOST || "";
const CAMERA_PORT = Number.parseInt(process.env.CAMERA_RTSP_PORT || "554", 10);
const CAMERA_CHANNEL = process.env.CAMERA_RTSP_CHANNEL || "101";
const CAMERA_USERNAME = process.env.CAMERA_RTSP_USERNAME || "";
const CAMERA_PASSWORD = process.env.CAMERA_RTSP_PASSWORD || "";
// A captura guarda apenas o quadro mais recente para evidência, não reproduz vídeo.
// Cinco quadros por segundo mantêm a janela de 750 ms com folga e reduzem codificações JPEG.
const CAMERA_OUTPUT_FPS = cameraOutputFps(process.env.CAMERA_OUTPUT_FPS);
// O intervalo também limita quanto um saco pode avançar antes de o worker reservar sua foto.
const JOB_POLL_MS = boundedInteger(process.env.CAMERA_JOB_POLL_MS, 200, 100, 5000);
const FRAME_FRESH_MS = boundedInteger(process.env.CAMERA_FRAME_FRESH_MS, 750, 200, 5000);
const HEARTBEAT_MS = boundedInteger(process.env.CAMERA_HEARTBEAT_INTERVAL_MS, 5000, 1000, 60000);
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const API_RETRY_MAX_MS = 2000;
const API_FAILURE_LOG_INTERVAL_MS = 30000;
const SHUTDOWN_GRACE_MS = 5000;

let latestFrame = null;
let latestFrameAt = 0;
let shuttingDown = false;
let activeFfmpegChild = null;
const apiFailureLogState = new Map();

function log(level, message, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    message,
    ...details,
  };
  const output = JSON.stringify(entry);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.info(output);
  }
}

function isPrivateCameraAddress(value) {
  if (isIP(value) !== 4) return false;
  const octets = value.split(".").map(Number);
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function cameraConfigurationIsComplete() {
  return isPrivateCameraAddress(CAMERA_HOST)
    && Number.isInteger(CAMERA_PORT) && CAMERA_PORT >= 1 && CAMERA_PORT <= 65535
    && /^\d{3,4}$/.test(CAMERA_CHANNEL)
    && CAMERA_USERNAME.length > 0 && CAMERA_PASSWORD.length > 0;
}

function streamUrl() {
  const url = new URL("rtsp://" + CAMERA_HOST + ":" + CAMERA_PORT + "/Streaming/channels/" + CAMERA_CHANNEL);
  url.username = CAMERA_USERNAME;
  url.password = CAMERA_PASSWORD;
  return url.toString();
}

function frameIsFresh() {
  return latestFrame !== null && Date.now() - latestFrameAt <= FRAME_FRESH_MS;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reportApiFailure(operation, message, error) {
  const now = Date.now();
  const reason = (error instanceof Error ? error.message : String(error || "erro inesperado"))
    .slice(0, 300);
  const previous = apiFailureLogState.get(operation);
  if (
    previous?.reason === reason &&
    now - previous.loggedAt < API_FAILURE_LOG_INTERVAL_MS
  ) return;

  apiFailureLogState.set(operation, { reason, loggedAt: now });
  log("warn", message, { operation, reason });
}

function apiRetryDelay(failureCount) {
  const multiplier = 2 ** Math.min(failureCount, 8);
  return Math.max(
    JOB_POLL_MS,
    Math.min(API_RETRY_MAX_MS, JOB_POLL_MS * multiplier),
  );
}

async function apiRequest(path, { jsonBody = null, formBody = null } = {}) {
  const headers = { "X-Device-Token": DEVICE_TOKEN };
  let body;
  if (formBody) {
    body = formBody;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(jsonBody ?? {});
  }

  const response = await fetch(new URL(path, API_BASE + "/"), {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    await response.arrayBuffer();
    throw new Error("Trace API respondeu HTTP " + response.status + " em " + path);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function publishHeartbeat() {
  const online = frameIsFresh();
  const details = {
    protocol: "RTSP",
    stream_ready: online,
  };
  if (online) {
    details.frame_age_ms = Math.max(0, Date.now() - latestFrameAt);
  } else if (!cameraConfigurationIsComplete()) {
    details.reason_code = "camera_config_missing";
  } else {
    details.reason_code = "stream_unavailable";
  }
  await apiRequest("/api/device_heartbeat.php", {
    jsonBody: { status: online ? "ONLINE" : "OFFLINE", details },
  });
}

function collectJpegs(child) {
  const collector = new JpegFrameCollector(MAX_FRAME_BYTES);

  child.stdout.on("data", (chunk) => {
    const jpeg = collector.pushLatest(chunk);
    if (jpeg) {
      latestFrame = jpeg;
      latestFrameAt = Date.now();
    }
  });
  child.stdout.on("error", () => {
    collector.reset();
  });
}

async function runFfmpeg() {
  const argumentsList = createFfmpegArguments(CAMERA_OUTPUT_FPS);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    // FFmpeg lê a URL pela entrada padrão para não expor usuário e senha no ps.
    const child = spawn("ffmpeg", argumentsList, { stdio: ["pipe", "pipe", "ignore"] });
    activeFfmpegChild = child;
    collectJpegs(child);
    child.stdin.once("error", (error) => {
      log("warn", "Não foi possível enviar o endereço RTSP ao FFmpeg.", {
        code: error.code || "ERRO_ENTRADA_FFMPEG",
      });
    });
    child.stdin.end(createFfmpegInputList(streamUrl()), "utf8");
    child.once("error", () => {
      activeFfmpegChild = null;
      finish(null);
    });
    child.once("close", (code) => {
      activeFfmpegChild = null;
      finish(code);
    });
    child.once("exit", (code) => {
      if (code !== null) finish(code);
    });

    const stopChild = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, SHUTDOWN_GRACE_MS);
      forceTimer.unref();
      finish(0);
    };
    if (shuttingDown) stopChild();
    else child.once("stop-camera-worker", stopChild);
  });
}

async function keepStreamConnected() {
  if (!cameraConfigurationIsComplete()) {
    log("warn", "Câmera sem configuração RTSP completa; serviço aguardando configuração.");
    return;
  }

  let failureCount = 0;
  while (!shuttingDown) {
    latestFrame = null;
    latestFrameAt = 0;
    const exitCode = await runFfmpeg();
    const hadFrames = latestFrameAt > 0;
    latestFrame = null;
    latestFrameAt = 0;
    if (shuttingDown) break;

    failureCount = hadFrames ? 1 : failureCount + 1;
    const retryMs = Math.min(30000, 1000 * (2 ** Math.min(failureCount - 1, 5)));
    log("warn", "Stream RTSP desconectado; reconexão automática agendada.", {
      retry_ms: retryMs,
      ffmpeg_exit_code: exitCode,
    });
    await sleep(retryMs);
  }
}

async function waitForFreshFrame(timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!shuttingDown && Date.now() <= deadline) {
    if (frameIsFresh()) return latestFrame;
    await sleep(50);
  }
  return null;
}

async function completeRequest(request, evidencePdfPath) {
  await apiRequest("/api/camera_worker.php", {
    jsonBody: {
      action: "COMPLETE",
      request_id: request.id,
      evidence_pdf_path: evidencePdfPath,
    },
  });
}

async function processRequest(request) {
  if (!request || !Number.isInteger(Number(request.id))) {
    throw new Error("A API devolveu uma solicitação de captura inválida.");
  }

  let evidencePdfPath = typeof request.evidence_pdf_path === "string"
    ? request.evidence_pdf_path
    : "";
  if (!evidencePdfPath) {
    const jpeg = await waitForFreshFrame();
    if (!jpeg) throw new Error("Não há quadro recente da câmera para esta solicitação.");

    const form = new FormData();
    form.append("request_id", String(request.id));
    form.append("file", new Blob([jpeg], { type: "image/jpeg" }), "camera-capture.jpg");
    const result = await apiRequest("/api/camera_upload.php", { formBody: form });
    evidencePdfPath = result?.data?.evidence_pdf_path || "";
    if (!evidencePdfPath) throw new Error("A API não confirmou o PDF da evidência.");
  }

  await completeRequest(request, evidencePdfPath);
  log("info", "Foto de evidência capturada e confirmada.", { request_id: Number(request.id) });
}

async function pollRequests() {
  let lastHeartbeatAt = 0;
  let claimFailureCount = 0;
  while (!shuttingDown) {
    const now = Date.now();
    if (now - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = now;
      try {
        await publishHeartbeat();
        apiFailureLogState.delete("heartbeat");
      } catch (error) {
        reportApiFailure("heartbeat", "Não foi possível atualizar o heartbeat da câmera.", error);
      }
    }

    if (frameIsFresh() && DEVICE_TOKEN) {
      try {
        const result = await apiRequest("/api/camera_worker.php", {
          jsonBody: { action: "CLAIM" },
        });
        claimFailureCount = 0;
        apiFailureLogState.delete("claim");
        const request = result?.data || null;
        if (request) {
          try {
            await processRequest(request);
          } catch (error) {
            log("warn", "Captura não concluída; a reserva será recuperada automaticamente.", {
              request_id: Number(request.id) || null,
              reason: error instanceof Error ? error.message : "erro inesperado",
            });
          }
        }
      } catch (error) {
        claimFailureCount = Math.min(claimFailureCount + 1, 8);
        reportApiFailure("claim", "Não foi possível consultar a fila de captura do Trace.", error);
        await sleep(apiRetryDelay(claimFailureCount));
        continue;
      }
    }
    await sleep(JOB_POLL_MS);
  }
}

const healthServer = createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    service: SERVICE_NAME,
    running: true,
    camera_configured: cameraConfigurationIsComplete(),
    stream_ready: frameIsFresh(),
  }));
});
healthServer.listen(8090, "0.0.0.0");

function requestShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "Encerrando worker da câmera.", { signal });
  healthServer.close();
  if (activeFfmpegChild) activeFfmpegChild.emit("stop-camera-worker");
}

let keepStreamPromise = null;
process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("SIGINT", () => requestShutdown("SIGINT"));

if (!DEVICE_TOKEN) {
  log("error", "CAMERA_DEVICE_TOKEN não foi configurado.");
  process.exitCode = 1;
} else {
  log("info", "Configuração do worker da câmera carregada.", {
    output_fps: CAMERA_OUTPUT_FPS,
    queue_poll_ms: JOB_POLL_MS,
    frame_fresh_ms: FRAME_FRESH_MS,
    heartbeat_interval_ms: HEARTBEAT_MS,
  });
  if (!cameraConfigurationIsComplete()) {
    log("warn", "Configure IP privado, usuário e senha RTSP para habilitar a câmera.");
  }
  keepStreamPromise = keepStreamConnected();
  await pollRequests();
  await keepStreamPromise;
}
