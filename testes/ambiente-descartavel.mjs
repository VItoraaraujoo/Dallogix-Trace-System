import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("./lib/ambiente_descartavel.sh", import.meta.url));
const invoke = (environment = {}) => {
  const env = { ...process.env, ...environment };
  for (const key of ["TRACE_BASE_URL", "TRACE_REGRESSION_DISPOSABLE"]) {
    if (!(key in environment)) delete env[key];
  }
  return spawnSync(
    "bash",
    ["-c", 'source "$1"; trace_preparar_ambiente_descartavel; printf "%s\\n%s\\n%s\\n" "$TRACE_BASE_URL" "$trace_test_tmp_dir" "$(umask)"', "test", helper],
    { encoding: "utf8", env },
  );
};

test("recusa etapa HTTP sem URL de fixture explícita", () => {
  const result = invoke();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /TRACE_BASE_URL/);
});

test("recusa etapa HTTP sem confirmação de fixture descartável", () => {
  const result = invoke({ TRACE_BASE_URL: "http://localhost:8080" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /TRACE_REGRESSION_DISPOSABLE=1/);
});

test("recusa um alvo que não seja loopback", () => {
  const result = invoke({
    TRACE_BASE_URL: "https://example.invalid",
    TRACE_REGRESSION_DISPOSABLE: "1",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /loopback/);
});

test("normaliza loopback, restringe permissões e limpa o temporário ao sair", () => {
  const result = invoke({
    TRACE_BASE_URL: "http://localhost:8080/",
    TRACE_REGRESSION_DISPOSABLE: "1",
  });
  assert.equal(result.status, 0, result.stderr);
  const [baseUrl, tempDir, mask] = result.stdout.trim().split("\n");
  assert.equal(baseUrl, "http://localhost:8080");
  assert.equal(mask, "0077");
  assert.match(tempDir, /^\/tmp\/dallogix-trace-test\./);
  assert.equal(existsSync(tempDir), false);
});
