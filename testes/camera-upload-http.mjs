import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBxdWFsaXR5ID0gODUK/9sAQwAFAwQEBAMFBAQEBQUFBgcMCAcHBwcPCwsJDBEPEhIRDxERExYcFxMUGhURERghGBodHR8fHxMXIiQiHiQcHh8e/9sAQwEFBQUHBgcOCAgOHhQRFB4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4e/8AAEQgAAgACAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJSYnKCkqKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A8nooor6o+cP/2Q==", "base64");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("upload JPEG da câmera exige token e reserva; retry preserva um único PDF", async () => {
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
  async function upload(requestId, bytes = jpeg, token = "test-camera-token") {
    const form = new FormData();
    form.append("request_id", String(requestId));
    form.append("file", new Blob([bytes], { type: "image/jpeg" }), "capture.jpg");
    const response = await fetch(url, { method: "POST", headers: { "X-Device-Token": token }, body: form });
    return { status: response.status, body: await response.json() };
  }
  async function complete(evidencePdfPath) {
    const response = await fetch(`http://127.0.0.1:${port}/api/camera_worker.php`, {
      method: "POST", headers: { "X-Device-Token": "test-camera-token", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "COMPLETE", request_id: 42, evidence_pdf_path: evidencePdfPath }),
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
    assert.equal((await upload(42, jpeg, "wrong-token")).status, 401);
    assert.equal((await upload(43)).status, 404);
    assert.equal((await upload(42, Buffer.from("not an image"))).status, 422);
    const expectedPathPattern = /^company_1\/equipment_7\/capture-42-[a-f0-9]{64}\.pdf$/;
    const expectedPath = `company_1/equipment_7/capture-42-${"0".repeat(64)}.pdf`;
    assert.equal((await complete(expectedPath)).status, 409);
    const first = await upload(42);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.match(first.body.data.evidence_pdf_path, expectedPathPattern);
    const retry = await upload(42);
    assert.equal(retry.status, 201, JSON.stringify(retry.body));
    assert.equal(retry.body.data.evidence_pdf_path, first.body.data.evidence_pdf_path);
    const completed = await complete(first.body.data.evidence_pdf_path);
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.data.status, "CAPTURADA");
    const evidenceDirectory = path.join(storage, "company_1", "equipment_7");
    const files = await readdir(evidenceDirectory);
    assert.deepEqual(files, [path.basename(first.body.data.evidence_pdf_path)]);
    const pdf = await readFile(path.join(evidenceDirectory, files[0]));
    assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
    assert.equal(pdf.includes(jpeg), true, "o PDF deve preservar os bytes JPEG originais");
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(storage, { recursive: true, force: true });
  }
});
