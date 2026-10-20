import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const updater = readFileSync(new URL("../scripts/update_trace.sh", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/release-production.yml", import.meta.url), "utf8");
const funcaoAdiarAtualizacao = updater.match(/adiar_atualizacao\(\) \{[\s\S]*?\n\}/)?.[0];

test("adiamento do verificador automático é sucesso e mantém a mensagem", () => {
  assert.ok(funcaoAdiarAtualizacao, "script deve definir o tratamento de adiamentos esperados");
  const result = spawnSync(
    "bash",
    ["-c", `${funcaoAdiarAtualizacao}\nadiar_atualizacao 14 'carga ativa'`],
    {
      encoding: "utf8",
      env: { ...process.env, TRACE_UPDATE_EXPECT_VERSION: "" },
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "carga ativa");
  assert.equal(result.stderr, "");
});

test("publicação explícita preserva os códigos de retry do atualizador", () => {
  assert.ok(funcaoAdiarAtualizacao, "script deve definir o tratamento de adiamentos esperados");
  const result = spawnSync(
    "bash",
    ["-c", `${funcaoAdiarAtualizacao}\nadiar_atualizacao 9 'atualização em execução'`],
    {
      encoding: "utf8",
      env: { ...process.env, TRACE_UPDATE_EXPECT_VERSION: "v1.0.170" },
    },
  );
  assert.equal(result.status, 9);
  assert.equal(result.stdout.trim(), "atualização em execução");
  assert.equal(result.stderr, "");
  assert.match(workflow, /TRACE_UPDATE_EXPECT_VERSION="\$version"/);
});

test("trava, manutenção e carga ativa usam o tratamento de adiamento", () => {
  assert.match(updater, /adiar_atualizacao 9 "Já existe uma atualização em execução/);
  assert.match(updater, /adiar_atualizacao 14 "O sistema já está em manutenção/);
  assert.match(updater, /adiar_atualizacao 14 "Atualização adiada: existe carregamento ativo/);
});
