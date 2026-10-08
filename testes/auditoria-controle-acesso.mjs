import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

test("rotas operacionais liberam a sessão antes de consultas demoradas", () => {
  const root = new URL("../servidor/api/", import.meta.url);
  const routes = [
    "operacoes/comando_maquina.php",
    "operacoes/comandos_industriais.php",
    "operacoes/carregamentos.php",
    "monitoramento/monitoramento.php",
    "operacoes/leituras.php",
  ];

  for (const route of routes) {
    const source = readFileSync(new URL(route, root), "utf8");
    assert.match(source, /session_write_close\(\);/, route);
    assert.match(source, /require_session_user\(\)|require_role\(|exigir_sessao_usuario\(/, route);
    const closeSession = source.indexOf("session_write_close();");
    const databaseWork = source.search(/require_active_license\(db\(|obter_conexao_banco\(\)|db\(\)->prepare|new Servico(ComandoClp|Leituras|Monitoramento)/);
    assert.ok(closeSession < databaseWork, route + " mantém a sessão aberta durante acesso ao banco");
  }
});
