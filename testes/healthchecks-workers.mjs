import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const syncWorker = readFileSync(new URL("../scripts/sync_worker.php", import.meta.url), "utf8");
const pruneImages = readFileSync(new URL("../scripts/prune_images.php", import.meta.url), "utf8");

test("câmera só fica saudável depois de entregar quadro recente", () => {
  assert.match(compose, /health\?\.?stream_ready === true/);
});

test("sincronização e retenção renovam heartbeat só após sucesso", () => {
  assert.match(compose, /if php \/var\/www\/scripts\/sync_worker\.php; then php \/var\/www\/scripts\/write_heartbeat\.php \/tmp\/trace-sync-worker-heartbeat/);
  assert.match(compose, /if php \/var\/www\/scripts\/prune_images\.php && php \/var\/www\/scripts\/prune_operational_data\.php; then php \/var\/www\/scripts\/write_heartbeat\.php \/tmp\/trace-retention-heartbeat/);
  assert.match(syncWorker, /if \(\$summary\["failed"\] > 0/);
  assert.match(pruneImages, /if \(\$failed > 0\) \{[\s\S]*?exit\(1\);/);
});
