import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const raiz = join(process.cwd(), "interface");
const versaoAplicacao = "202610160004";
const versaoAplicacaoImportacao = "202610160004";
const versaoServiceWorker = "202610160002";
const versaoTela = "202610160004";
const versaoTelaImportacao = "202610130005";
const versaoTelaOperacao = "202610160004";
const versaoEstiloConfiguracoes = "202610160001";
const versaoEstiloDalas = "202610160004";
const versaoEstiloOperacao = "202610140001";
const versaoEstiloImportacao = "202610071845";

test("o shell invalida cache quando a aplicação muda", () => {
  const serviceWorker = readFileSync(join(raiz, "service-worker.js"), "utf8");
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  assert.match(serviceWorker, /trace-shell-20261016-02/);
  assert.match(aplicacao, /notificacoes\.js\?v=202610160002/);
  assert.match(aplicacao, new RegExp(`/service-worker\\.js\\?v=${versaoServiceWorker}`));
  assert.match(aplicacao, new RegExp(`ArmazenamentoTrace\\.js\\?v=${versaoTela}`));
  assert.match(aplicacao, new RegExp(`operacao\\.js\\?v=${versaoTelaOperacao}`));
  assert.match(aplicacao, new RegExp(`importar-romaneio\\.js\\?v=${versaoTelaImportacao}`));
  assert.match(aplicacao, /page-refresh\.js\?v=202610130001/);
  assert.match(aplicacao, /tempo-real\.js\?v=202610140001/);
  assert.match(aplicacao, /configuracoes\.js\?v=202610160002/);
  assert.match(aplicacao, /controladores\/operacao\.js\?v=202610160004/);
  assert.match(aplicacao, /renderStatusDalaBinario/);
  const controlador = readFileSync(join(raiz, "js", "controladores", "operacao.js"), "utf8");
  assert.match(controlador, /status-dala\.js\?v=202610160004/);
});

test("arquivos estáticos versionados reaproveitam o cache e respostas compactadas", () => {
  const serviceWorker = readFileSync(join(raiz, "service-worker.js"), "utf8");
  const nginx = readFileSync(join(process.cwd(), "nginx", "default.conf"), "utf8");
  assert.match(serviceWorker, /function isVersionedStaticAsset\(url\)/);
  assert.match(serviceWorker, /const cached = await caches\.match\(request\)/);
  assert.doesNotMatch(serviceWorker, /cache:\s*["'](?:no-store|reload)["']/);
  assert.match(nginx, /gzip on;/);
  assert.match(nginx, /gzip_types[^;]*application\/json[^;]*text\/css/);
  assert.ok(nginx.includes('map "$uri:$arg_v" $trace_static_cache_age'));
  assert.ok(nginx.includes('~^/service-worker\\.js: "no-cache, must-revalidate";'));
  assert.ok(nginx.includes("~^[^:]+:[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]"));
  assert.match(nginx, /max-age=31536000, immutable/);
  assert.match(nginx, /no-cache, must-revalidate/);
});

test("todas as telas carregam a aplicação com a versão atual", () => {
  const htmls = [];
  const visitar = (directory) => {
    for (const name of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, name.name);
      if (name.isDirectory()) visitar(path);
      else if (name.name.endsWith(".html")) htmls.push(path);
    }
  };
  visitar(raiz);
  const telasComAplicacao = htmls.filter((path) => readFileSync(path, "utf8").includes("/js/aplicacao.js?v="));
  assert.ok(telasComAplicacao.length > 0);
  for (const path of telasComAplicacao) {
    const versaoEsperada = path.endsWith(join("importar-romaneio", "importar-romaneio.html"))
      ? versaoAplicacaoImportacao
      : versaoAplicacao;
    assert.match(readFileSync(path, "utf8"), new RegExp(`/js/aplicacao\\.js\\?v=${versaoEsperada}`), path);
  }
});

test("a navegação não exibe uma tela intermediária de carregamento", () => {
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  assert.doesNotMatch(aplicacao, /Abrindo tela/);
  assert.doesNotMatch(aplicacao, /root\.innerHTML\s*=\s*[\s\S]{0,180}page-loading/);
});

test("a navegação interna carrega os estilos exclusivos das telas alteradas", () => {
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  for (const path of [
    `/telas/dalas/dalas.css?v=${versaoEstiloDalas}`,
    `/telas/operacao/operacao.css?v=${versaoEstiloOperacao}`,
    `/telas/importar-romaneio/importar-romaneio.css?v=${versaoEstiloImportacao}`,
    `/telas/configuracoes/configuracoes.css?v=${versaoEstiloConfiguracoes}`,
  ]) assert.ok(aplicacao.includes(path), `estilo não registrado no roteador: ${path}`);
  assert.match(aplicacao, /await ensureScreenStyles\(currentPage\)/);
});

test("ações das Dalas atualizam os estilos compartilhados com o cache correto", () => {
  const tela = readFileSync(join(raiz, "telas", "dalas", "dalas.html"), "utf8");
  const estilos = readFileSync(join(raiz, "telas", "dalas", "dalas.css"), "utf8");
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  assert.match(tela, new RegExp(`/telas/dalas/dalas\\.css\\?v=${versaoEstiloDalas}`));
  assert.match(estilos, new RegExp(`/css/responsive\\.css\\?v=${versaoEstiloDalas}`));
  assert.match(estilos, new RegExp(`/css/dalas-screen\\.css\\?v=${versaoEstiloDalas}`));
  for (const page of ["dalas", "dala", "dala-edit"]) {
    const chave = page === "dala-edit" ? '"dala-edit"' : page;
    assert.ok(aplicacao.includes(`${chave}: "/telas/dalas/dalas.css?v=${versaoEstiloDalas}"`));
  }
});

test("a tela inicial da operação usa o CSS com cache atualizado", () => {
  const tela = readFileSync(join(raiz, "telas", "operacao", "operacao.html"), "utf8");
  assert.match(tela, new RegExp(`/telas/operacao/operacao\\.css\\?v=${versaoEstiloOperacao}`));
});

test("Novo romaneio referencia o CSS alinhado com cache versionado", () => {
  const tela = readFileSync(join(raiz, "telas", "importar-romaneio", "importar-romaneio.html"), "utf8");
  const estilos = readFileSync(join(raiz, "telas", "importar-romaneio", "importar-romaneio.css"), "utf8");
  assert.match(tela, new RegExp(`/telas/importar-romaneio/importar-romaneio\\.css\\?v=${versaoEstiloImportacao}`));
  assert.match(estilos, /\.pdf-import-card form\s*\{[^}]*display:\s*grid/);
  assert.match(estilos, /\.pdf-import-card \.file-picker\s*\{[^}]*grid-template-columns:/);
});

test("a operação deixa os estados em Configurações e usa leitura automática", () => {
  const operacao = readFileSync(join(raiz, "telas", "operacao", "operacao.js"), "utf8");
  const operacaoCss = readFileSync(join(raiz, "telas", "operacao", "operacao.css"), "utf8");
  const configuracoes = readFileSync(join(raiz, "telas", "configuracoes", "configuracoes.js"), "utf8");
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  assert.doesNotMatch(operacao, /work-header-statuses/);
  assert.doesNotMatch(operacao, /emergencyPanel/);
  assert.doesNotMatch(operacao, /Registrar leitura/);
  assert.doesNotMatch(operacao, /O leitor envia Enter automaticamente|Há leituras sem código pendentes/);
  assert.match(operacao, /placeholder=\"\$\{manualReadingPlaceholder\}\"\$\{manualReadingDisabled \? \" disabled\" : \" autofocus\"\}/);
  assert.match(aplicacao, /barcodeInput\?\.addEventListener\(\"keydown\"/);
  assert.match(configuracoes, /settings-device-status-panel/);
  assert.match(operacaoCss, /@media \(min-width: 960px\) and \(min-height: 680px\) and \(max-height: 820px\)/);
  assert.match(operacaoCss, /body\.work-page:has\(\.work-operation-screen\) \{[^}]*overflow: auto;/);
  assert.match(aplicacao, /store\.loadMonitoring\(\).*store\.loadEquipments/);
  assert.match(aplicacao, /statusScreensRealtime\.start\(\)/);
  assert.match(aplicacao, /createPageRefreshController/);
});

test("modelo CSV usa caminho absoluto e nome de arquivo estável", () => {
  const tela = readFileSync(join(raiz, "telas", "importar-romaneio", "importar-romaneio.js"), "utf8");
  assert.match(tela, /href="\/assets\/modelo-romaneio\.csv" download="modelo-romaneio\.csv"/);
  assert.equal(existsSync(join(raiz, "assets", "modelo-romaneio.csv")), true);
});

test("notificações flutuantes estão desativadas globalmente", () => {
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  const operacaoCss = readFileSync(join(raiz, "telas", "operacao", "operacao.css"), "utf8");
  const notificacoes = readFileSync(join(raiz, "js", "componentes", "notificacoes.js"), "utf8");
  assert.match(aplicacao, /if \(currentPage === "work"\) return;/);
  assert.doesNotMatch(aplicacao, /timedCommandConfirmation|command-confirm-overlay/);
  assert.match(notificacoes, /export function notificar\(mensagem, tipo/);
  assert.match(notificacoes, /container\.prepend\(notice\)/);
  assert.doesNotMatch(operacaoCss, /#trace-notificacoes/);
});
