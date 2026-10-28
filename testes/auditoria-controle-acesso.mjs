import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
    "sincronizacao/sync_status.php",
  ];

  for (const route of routes) {
    const source = readFileSync(new URL(route, root), "utf8");
    assert.match(source, /session_write_close\(\);/, route);
    assert.match(source, /require_session_user\(\)|require_role\(|exigir_sessao_usuario\(/, route);
    const closeSession = source.indexOf("session_write_close();");
    const databaseWork = source.search(/require_active_license\(db\(|obter_conexao_banco\(\)|\$pdo\s*=\s*db\(\)|db\(\)->prepare|new Servico(ComandoClp|Leituras|Monitoramento)/);
    assert.ok(closeSession < databaseWork, route + " mantém a sessão aberta durante acesso ao banco");
  }
});

test("rotas administrativas de leitura liberam a sessão antes do banco", () => {
  const root = new URL("../servidor/api/", import.meta.url);
  const routes = [
    "produtos/produtos.php",
    "romaneios/romaneios.php",
    "sincronizacao/sync_dead_letter.php",
    "sistema/configuracoes.php",
    "usuarios/usuarios.php",
  ];

  for (const route of routes) {
    const source = readFileSync(new URL(route, root), "utf8");
    const closeSession = source.indexOf("session_write_close();");
    const databaseConnection = source.indexOf("$pdo = obter_conexao_banco();");
    assert.ok(closeSession >= 0, route + " não libera o bloqueio da sessão em GET");
    assert.ok(databaseConnection >= 0, route + " não abre a conexão esperada");
    assert.ok(closeSession < databaseConnection, route + " mantém a sessão aberta durante consultas");
    assert.match(source, /if \(\$_SERVER\["REQUEST_METHOD"\] === "GET"\)\s*\{\s*session_write_close\(\);/s, route);
  }

  const companies = readFileSync(new URL("empresas/empresas.php", root), "utf8");
  const getGuard = companies.indexOf('if ($_SERVER["REQUEST_METHOD"] !== "GET")');
  const closeSession = companies.indexOf("session_write_close();", getGuard);
  const getQuery = companies.indexOf('$isAdminDallogix =', getGuard);
  assert.ok(getGuard >= 0 && closeSession > getGuard && closeSession < getQuery);
});

test("consultas de status e relatórios liberam a sessão antes de I/O", () => {
  const root = new URL("../servidor/api/", import.meta.url);
  const routes = [
    "autenticacao/me.php",
    "dalas/acoes_dala.php",
    "dalas/dispositivos.php",
    "dalas/equipamentos.php",
    "empresas/licencas.php",
    "instalacoes_industriais.php",
    "monitoramento/dashboard.php",
    "operacoes/resumo_carregamento.php",
    "relatorios/relatorio_operacional.php",
  ];

  for (const route of routes) {
    const source = readFileSync(new URL(route, root), "utf8");
    const closeSession = source.indexOf("session_write_close();");
    assert.ok(closeSession >= 0, route + " não libera o bloqueio da sessão");
    if (route === "autenticacao/me.php") {
      assert.ok(source.indexOf("gerar_token_csrf()") < closeSession, "o token CSRF deve ser salvo antes de fechar a sessão");
      assert.ok(closeSession < source.indexOf("responder_json("));
      continue;
    }
    const databaseConnection = source.indexOf("$pdo = db();");
    assert.ok(databaseConnection >= 0, route + " não abre a conexão esperada");
    assert.ok(closeSession < databaseConnection, route + " mantém a sessão aberta durante I/O");
  }

  const auditReport = readFileSync(new URL("relatorios/relatorio_auditoria.php", root), "utf8");
  const sessionBranch = auditReport.indexOf("if (!is_array($apiClient))");
  const sessionClose = auditReport.indexOf("session_write_close();", sessionBranch);
  assert.ok(sessionBranch >= 0 && sessionClose > sessionBranch);
  assert.ok(sessionClose < auditReport.indexOf("$pdo = db();"));
});

test("status da sincronização calcula contagens e idade da fila com uma única consulta agrupada", () => {
  const endpoint = readFileSync(new URL("../servidor/api/sincronizacao/sync_status.php", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../servidor/src/Persistencia/RepositorioStatusSincronizacao.php", import.meta.url), "utf8");

  assert.ok(endpoint.includes("(new RepositorioStatusSincronizacao($pdo))->obterResumoFila"));
  assert.doesNotMatch(endpoint, /\$queueAge\s*=|SELECT MIN\(CASE WHEN q\.status/);
  assert.match(repository, /MIN\(CASE[\s\S]*?END\) OVER \(\) AS oldest_at/);
  assert.match(repository, /WHERE q\.company_id = :company_id/);
  assert.equal((repository.match(/\$this->connection->prepare\(/g) || []).length, 1);
});

test("REST e SSE usam carregamentos ativos sem agregar monitoramento no stream", () => {
  const root = new URL("../servidor/", import.meta.url);
  const endpoint = readFileSync(new URL("api/operacoes/carregamentos.php", root), "utf8");
  const eventEndpoint = readFileSync(new URL("api/operacoes/eventos_carregamento.php", root), "utf8");
  const service = readFileSync(new URL("src/Aplicacao/ServicoMonitoramento.php", root), "utf8");
  const repository = readFileSync(new URL("src/Persistencia/RepositorioMonitoramento.php", root), "utf8");

  assert.match(endpoint, /new ServicoMonitoramento\(\$pdo\)/);
  assert.match(endpoint, /carregamentosAtivos\(\(int\) \$usuarioAtor\["company_id"\]\)/);
  assert.match(eventEndpoint, /carregamentosAtivos\(\$companyId\)/);
  assert.doesNotMatch(eventEndpoint, /obterInstantaneo\(/);
  assert.match(service, /\$this->repositorio->listarCarregamentosAtivos\(\$companyId\)/);
  assert.match(repository, /WITH carregamentos_ativos AS/);
  assert.match(
    repository,
    /JOIN carregamentos_ativos ca\s+ON ca\.id = se\.carregamento_id AND ca\.equipment_id = se\.equipment_id/,
  );
  assert.match(repository, /COALESCE\(ed\.detected_bags, 0\) AS detected_bags/);
  assert.doesNotMatch(endpoint, /eventos_detectados|quantidades_planejadas/);
});

test("monitoramento oferece um resumo reduzido para a atualização automática de Alertas", () => {
  const endpoint = readFileSync(new URL("../servidor/api/monitoramento/monitoramento.php", import.meta.url), "utf8");
  const service = readFileSync(new URL("../servidor/src/Aplicacao/ServicoMonitoramento.php", import.meta.url), "utf8");

  assert.match(endpoint, /\$view = \(string\) \(\$_GET\["view"\] \?\? ""\)/);
  assert.match(endpoint, /"alertas"\s*=>\s*\$service->obterResumoAlertas/);
  assert.match(endpoint, /"resumo"\s*=>\s*\$service->obterResumoFinal/);
  assert.match(endpoint, /default\s*=>\s*\$service->obterInstantaneo/);
  assert.match(endpoint, /obterResumoAlertas\(\$companyId, \$periodDays/);
  assert.match(endpoint, /obterInstantaneo\(\$companyId, \$periodDays/);
  assert.match(service, /public function obterResumoAlertas\(/);
  assert.match(service, /\$this->repositorio->contarLeituras\(\$companyId, \$periodDays\)/);
  assert.match(service, /\$this->obterStatusDispositivos\(\$companyId, \$clpSignalLimit, \$cameraSignalLimit\)/);
  assert.match(service, /\$this->obterMaquinas\(\$companyId, \$clpSignalLimit\)/);
});

test("sessões de perfis altos não são renovadas apenas pelo polling", () => {
  const bootstrapPath = fileURLToPath(new URL("../servidor/configuracao/bootstrap.php", import.meta.url));
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
