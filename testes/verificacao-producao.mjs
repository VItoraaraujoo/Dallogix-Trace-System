import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, symlinkSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const checker = process.env.TRACE_PRODUCTION_CHECK_TEST_SCRIPT || fileURLToPath(new URL("../scripts/check_production_env.sh", import.meta.url));

function runCheck({ result = "0", exitCode = "0", missingDocker = false, skipDatabase = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), "trace-production-check-"));
  const scripts = join(base, "scripts");
  const bin = join(base, "bin");
  const envFile = join(base, "production.env");
  const argumentLog = join(base, "docker-args");
  mkdirSync(scripts);
  mkdirSync(bin);
  copyFileSync(checker, join(scripts, "check_production_env.sh"));
  copyFileSync(new URL("../scripts/docker_compose.sh", import.meta.url), join(scripts, "docker_compose.sh"));
  symlinkSync("/bin/bash", join(bin, "bash"));
  symlinkSync("/usr/bin/dirname", join(bin, "dirname"));
  writeFileSync(envFile, [
    "MYSQL_PASSWORD=fixture-database-only-for-tests",
    "MYSQL_ROOT_PASSWORD=fixture-root-only-for-tests",
    "TRACE_DEVICE_TOKEN=fixture-device-only-for-tests",
    "CAMERA_DEVICE_TOKEN=fixture-camera-only-for-tests",
    "APP_URL=https://fixture.example.invalid",
    "APP_ENV=production", "TRACE_INSTALLATION_MODE=central", "SESSION_SECURE=true",
    "BIND_ADDRESS=127.0.0.1", "WEB_BIND_ADDRESS=127.0.0.1",
    "TRACE_ENV_CHECK_SKIP_DATABASE=" + (skipDatabase ? "1" : "0"),
  ].join("\n") + "\n");
  if (!missingDocker) {
    const docker = join(bin, "docker");
    writeFileSync(docker, String.raw`#!/bin/bash
if [[ "$1" == "info" ]]; then exit 0; fi
if [[ "$1" != "compose" ]]; then exit 99; fi
printf '%s\0' "$@" >> "$TRACE_TEST_DOCKER_ARGS"
if [[ "$TRACE_TEST_MYSQL_EXIT" != "0" ]]; then
  echo "fixture: MySQL indisponível" >&2
  exit "$TRACE_TEST_MYSQL_EXIT"
fi
printf '%s\n' "$TRACE_TEST_MYSQL_RESULT"
`);
    chmodSync(docker, 0o755);
  }
  try {
    const execution = spawnSync("/bin/bash", [join(scripts, "check_production_env.sh"), envFile], {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, PATH: bin, TRACE_DOCKER_BIN: "", TRACE_TEST_DOCKER_ARGS: argumentLog,
        TRACE_TEST_MYSQL_RESULT: result, TRACE_TEST_MYSQL_EXIT: exitCode,
        SYNC_REMOTE_URL: "", SYNC_REMOTE_BATCH_URL: "", TRACE_CENTRAL_URL: "",
        TRACE_TESTING_DISABLE_CSRF: "0", TRACE_TESTING_DISABLE_LOGIN_RATE_LIMIT: "0",
        TRACE_LOCAL_SIMULATION: "0", TRACE_SIMULATOR_ONLY_COMMANDS: "0" },
    });
    assert.equal(execution.error, undefined);
    const args = existsSync(argumentLog) ? readFileSync(argumentLog, "utf8").split("\0").slice(0, -1) : [];
    return { ...execution, args, base, envFile };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("verifica ambos os hashes via Compose com instalação e ambiente explícitos", () => {
  const check = runCheck();
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.args.filter(value => value === "compose").length, 2);
  assert.deepEqual(check.args.slice(0, 10), ["compose", "--project-directory", check.base,
    "--env-file", check.envFile, "-f", join(check.base, "docker-compose.yml"),
    "-f", join(check.base, "docker-compose.production.yml"), "exec"]);
  assert.match(check.stdout, /senhas de demonstração no banco verificadas/);
});

test("falha de consulta reprova a produção e não repete a mesma consulta", () => {
  const check = runCheck({ exitCode: "42" });
  assert.equal(check.status, 1);
  assert.match(check.stderr, /MySQL indisponível/);
  assert.match(check.stderr, /não foi possível consultar/);
  assert.equal(check.args.filter(value => value === "compose").length, 1);
  assert.doesNotMatch(check.stdout, /OK:/);
});

for (const result of ["", "unknown", "0\n0"]) {
  test(`contagem inválida ${JSON.stringify(result)} reprova a produção`, () => {
    const check = runCheck({ result });
    assert.equal(check.status, 1);
    assert.match(check.stderr, /contagem inválida/);
    assert.doesNotMatch(check.stdout, /OK:/);
  });
}

test("Docker ausente reprova em vez de pular a verificação do banco", () => {
  const check = runCheck({ missingDocker: true });
  assert.equal(check.status, 1);
  assert.match(check.stderr, /Docker não encontrado/);
  assert.match(check.stderr, /não foi possível consultar/);
});

test("hash conhecido reprova a produção", () => {
  const check = runCheck({ result: "1" });
  assert.equal(check.status, 1);
  assert.match(check.stderr, /hash de senha de demonstração/);
});

test("preparação sem banco exige opção explícita e informa a limitação", () => {
  const check = runCheck({ missingDocker: true, skipDatabase: true });
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(check.args, []);
  assert.match(check.stdout, /banco não verificado por opção explícita/);
});
