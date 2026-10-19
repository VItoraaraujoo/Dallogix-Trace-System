import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const composeTeste = readFileSync(new URL("../docker-compose.production-test.yml", import.meta.url), "utf8");
const extrairServicoMysql = (arquivo) => arquivo.match(/^  mysql:\n([\s\S]*?)(?=^  [a-z0-9_-]+:\s*$)/m)?.[1];
const servicosMysql = [extrairServicoMysql(compose), extrairServicoMysql(composeTeste)];
const limitesDiagnostico = [
  "--performance-schema-digests-size=1000",
  "--performance-schema-events-stages-history-long-size=1000",
  "--performance-schema-events-statements-history-long-size=1000",
  "--performance-schema-events-transactions-history-long-size=1000",
  "--performance-schema-events-waits-history-long-size=1000",
];

test("MySQL limita históricos de diagnóstico para caber no PC industrial", () => {
  assert.ok(servicosMysql[0], "serviço MySQL precisa estar definido no Compose principal");
  assert.match(servicosMysql[0], /mem_limit:\s*512m/);

  for (const [indice, servicoMysql] of servicosMysql.entries()) {
    assert.ok(servicoMysql, `serviço MySQL ${indice + 1} precisa estar definido no Compose`);

    for (const limite of limitesDiagnostico) {
      assert.ok(servicoMysql.includes(limite), `limite ausente no Compose ${indice + 1}: ${limite}`);
    }

    assert.doesNotMatch(servicoMysql, /--performance-schema=OFF/);
  }
});
