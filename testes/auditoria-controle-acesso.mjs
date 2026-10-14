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

test("REST e SSE compartilham o snapshot filtrado de carregamentos ativos", () => {
  const root = new URL("../servidor/", import.meta.url);
  const endpoint = readFileSync(new URL("api/operacoes/carregamentos.php", root), "utf8");
  const service = readFileSync(new URL("src/Aplicacao/ServicoMonitoramento.php", root), "utf8");

  assert.match(endpoint, /new ServicoMonitoramento\(\$pdo\)/);
  assert.match(endpoint, /carregamentosAtivos\(\(int\) \$usuarioAtor\["company_id"\]\)/);
  assert.match(service, /WITH carregamentos_ativos AS/);
  assert.match(service, /JOIN carregamentos_ativos ca ON ca\.id = se\.carregamento_id/);
  assert.match(service, /COALESCE\(ed\.detected_bags, 0\) AS detected_bags/);
  assert.doesNotMatch(endpoint, /eventos_detectados|quantidades_planejadas/);
});

test("sessões de perfis altos não são renovadas apenas pelo polling", () => {
  const bootstrapPath = new URL("../servidor/configuracao/bootstrap.php", import.meta.url).pathname;
  const script = `
    require_once ${JSON.stringify(bootstrapPath)};
    $_SERVER = ["REQUEST_METHOD" => "GET"];
    $polling = trace_requisicao_conta_como_atividade();
    $_SERVER["HTTP_X_TRACE_USER_ACTIVITY"] = "1";
    $interacao = trace_requisicao_conta_como_atividade();
    $_SERVER = ["REQUEST_METHOD" => "POST"];
    $mutacao = trace_requisicao_conta_como_atividade();
    echo json_encode([$polling, $interacao, $mutacao]);
  `;
  const output = execFileSync("php", ["-r", script], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), [false, true, true]);
});
