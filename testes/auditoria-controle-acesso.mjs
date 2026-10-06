import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("auditoria resolve wrappers da API e verifica o contrato efetivo", () => {
  const output = execFileSync(
    "php",
    ["scripts/auditoria_controle_acesso.php"],
    { encoding: "utf8" },
  );
  assert.match(output, /Total de arquivos verificados: \d+/);
  assert.match(output, /OK: todos os endpoints principais possuem bootstrap, controle de método e autenticação\/autorização observáveis\./);
  assert.doesNotMatch(output, /AVISOS ENCONTRADOS/);
});
