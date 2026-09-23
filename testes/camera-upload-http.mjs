import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/NssAAAAASUVORK5CYII=", "base64");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("upload de câmera exige token, reserva e imagem real; retry não duplica", async () => {
  const storage = await mkdtemp(path.join(os.tmpdir(), "trace-camera-http-"));
  const port = await freePort();
  const server = spawn("php", ["-S", `127.0.0.1:${port}`, "testes/isolado/camera-upload-router.php"], {
    cwd: root,
    env: { ...process.env, TRACE_CAMERA_TEST_STORAGE: storage },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  server.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const url = `http://127.0.0.1:${port}/api/camera_upload.php`;
  async function upload(requestId, bytes = png, token = "test-camera-token") {
    const form = new FormData();
    form.append("request_id", String(requestId));
    form.append("file", new Blob([bytes], { type: "image/png" }), "capture.png");
    const response = await fetch(url, { method: "POST", headers: { "X-Device-Token": token }, body: form });
    return { status: response.status, body: await response.json() };
  }
  async function complete(imagePath) {
    const response = await fetch(`http://127.0.0.1:${port}/api/camera_worker.php`, {
      method: "POST", headers: { "X-Device-Token": "test-camera-token", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "COMPLETE", request_id: 42, image_path: imagePath }),
    });
    return { status: response.status, body: await response.json() };
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (stderr.includes("Development Server")) { ready = true; break; }
      if (server.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(ready, true, stderr);
    assert.equal((await upload(42, png, "wrong-token")).status, 401);
    assert.equal((await upload(43)).status, 404);
    assert.equal((await upload(42, Buffer.from("not an image"))).status, 422);
    const expectedPath = `company_1/equipment_7/capture-42-${(await import("node:crypto")).createHash("sha256").update(png).digest("hex")}.png`;
    assert.equal((await complete(expectedPath)).status, 422);
    const first = await upload(42);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.match(first.body.data.image_path, /^company_1\/equipment_7\/capture-42-[a-f0-9]{64}\.png$/);
    const retry = await upload(42);
    assert.equal(retry.status, 201, JSON.stringify(retry.body));
    assert.equal(retry.body.data.image_path, first.body.data.image_path);
    const completed = await complete(first.body.data.image_path);
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.data.status, "CAPTURADA");
    const files = await readdir(path.join(storage, "company_1", "equipment_7"));
    assert.deepEqual(files, [path.basename(first.body.data.image_path)]);
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(storage, { recursive: true, force: true });
  }
});
