import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, chownSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const updater = process.env.TRACE_UPDATER_TEST_SCRIPT || fileURLToPath(new URL("../scripts/update_trace.sh", import.meta.url));
const publicKey = fileURLToPath(new URL("../servidor/configuracao/trace-update-public.pem", import.meta.url));

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "trace-updater-permissions-"));
  const installation = join(base, "installation");
  const storage = join(installation, "armazenamento");
  const state = join(storage, "updates");
  const directories = [base, installation, storage, state, join(state, "releases"), join(state, "backups")];
  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
    chmodSync(directory, 0o755);
  }
  const script = join(base, "update_trace.sh");
  const key = join(base, "public.pem");
  copyFileSync(updater, script);
  copyFileSync(publicKey, key);
  chmodSync(script, 0o644);
  chmodSync(key, 0o644);
  // O mesmo caso de usuário sem privilégios deve ser exercitado se o runner for root.
  const identity = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
  if (identity.uid !== undefined) {
    for (const directory of directories) chownSync(directory, identity.uid, identity.gid);
  }
  return {
    state,
    run() {
      return spawnSync("bash", [script], {
        ...identity,
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          TRACE_UPDATE_ROOT: installation,
          UPDATE_PUBLIC_KEY_FILE: key,
          TRACE_UPDATE_MANIFEST_FILE: join(base, "absent-manifest.json"),
        },
      });
    },
    dispose() {
      chmodSync(state, 0o755);
      rmSync(base, { recursive: true, force: true });
    },
  };
}

test("estado sem permissão falha com diagnóstico próprio, sem fingir atualização concorrente", () => {
  const setup = fixture();
  try {
    chmodSync(setup.state, 0o555);
    const result = setup.run();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 23, result.stderr);
    assert.match(result.stderr, /Sem permissão para gravar o estado/);
    assert.doesNotMatch(result.stderr, /Já existe uma atualização/);
    assert.equal(existsSync(join(setup.state, ".install.lock")), false);
  } finally {
    setup.dispose();
  }
});

test("uma trava existente continua adiando e permanece preservada", () => {
  const setup = fixture();
  try {
    const lock = join(setup.state, ".install.lock");
    mkdirSync(lock);
    const result = setup.run();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 9, result.stderr);
    assert.match(result.stderr, /Já existe uma atualização/);
    assert.equal(existsSync(lock), true);
  } finally {
    setup.dispose();
  }
});

test("a publicação passa versão, commit e arquivos aprovados ao atualizador administrativo", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-production.yml", import.meta.url), "utf8");
  const match = workflow.match(/^\s*run_updater\(\) \{\n[\s\S]*?^\s*\}/m);
  assert.ok(match, "Função administrativa de publicação não encontrada.");
  const commit = "a".repeat(40);
  const result = spawnSync("bash", ["-s"], {
    encoding: "utf8",
    input: `set -euo pipefail\nsudo() { printf '%s\\0' "$@"; }\napp_root=/opt/trace\nstage=/tmp/trace-stage\nversion=v1.0.19\ncommit=${commit}\n${match[0]}\nrun_updater\n`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\0").slice(0, -1), [
    "-n", "env", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "TRACE_UPDATE_ROOT=/opt/trace", "TRACE_UPDATE_MANIFEST_FILE=/tmp/trace-stage/manifest.json",
    "TRACE_UPDATE_ARTIFACT_FILE=/tmp/trace-stage/trace-v1.0.19.tar.gz", "TRACE_UPDATE_EXPECT_VERSION=v1.0.19",
    `TRACE_UPDATE_EXPECT_COMMIT=${commit}`, "bash", "/tmp/trace-stage/update_trace.sh",
  ]);
});
