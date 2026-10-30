import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const raiz = join(process.cwd(), "interface");
const versaoAplicacao = "202610300001";
const versaoAplicacaoImportacao = "202610300001";
const versaoServiceWorker = "202610300001";
const versaoTela = "202610300001";
const versaoTelaImportacao = "202610190046";
const versaoEstiloConfiguracoes = "202610160001";
const versaoEstiloDalas = "202610160005";
const versaoEstiloResponsivo = "202610160004";
const versaoEstiloOperacao = "202610300001";
const versaoEstiloImportacao = "202610071845";

test("o shell invalida cache quando a aplicação muda", () => {
  const serviceWorker = readFileSync(join(raiz, "service-worker.js"), "utf8");
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  const login = readFileSync(join(raiz, "js", "login.js"), "utf8");
  const telaAcesso = readFileSync(join(raiz, "telas", "acesso", "acesso.html"), "utf8");
  const armazenamento = readFileSync(join(raiz, "js", "classes", "ArmazenamentoTrace.js"), "utf8");
  const estadoVisualizacao = readFileSync(join(raiz, "js", "controladores", "estado-visualizacao.js"), "utf8");
  assert.match(serviceWorker, /trace-shell-20261030-56/);
  assert.match(serviceWorker, /const PRECACHE_CONCURRENCY = 4/);
  assert.match(serviceWorker, /const workerCount = Math\.min\(PRECACHE_CONCURRENCY, SHELL\.length\)/);
  assert.match(serviceWorker, /await Promise\.all\(Array\.from\(\{ length: workerCount \}, \(\) => worker\(\)\)\)/);
  assert.match(serviceWorker, /console\.warn\("Não foi possível pré-carregar o recurso do shell:"/);
  assert.match(serviceWorker, /APPLICATION_ASSET_VERSION = "202610300001"/);
  assert.match(serviceWorker, /currentCache\.match\(url\.pathname\)/);
  assert.match(aplicacao, /notificacoes\.js\?v=202610160002/);
  assert.match(aplicacao, /registro-telas\.js\?v=202610190046/);
  assert.doesNotMatch(aplicacao, /teclado-leitura-manual/);
  assert.doesNotMatch(aplicacao, /^import .* from ["']\.\.\/telas\//m);
  assert.match(aplicacao, /import\("\.\.\/telas\/operacao\/operacao\.js\?v=202610300001"\)/);
  assert.match(telaAcesso, /\/js\/login\.js\?v=202610190036/);
  assert.match(aplicacao, new RegExp(`/service-worker\\.js\\?v=${versaoServiceWorker}`));
  assert.match(aplicacao, new RegExp(`ArmazenamentoTrace\\.js\\?v=${versaoTela}`));
  assert.match(aplicacao, /operacao\.js\?v=202610300001/);
  assert.match(aplicacao, new RegExp(`importar-romaneio\\.js\\?v=${versaoTelaImportacao}`));
  assert.match(aplicacao, /page-refresh\.js\?v=202610130001/);
  assert.match(aplicacao, /status-dalas-tempo-real\.js\?v=202610200003/);
  assert.match(aplicacao, /dalaStatusRealtime\.start\(\)/);
  assert.match(aplicacao, /tempo-real\.js\?v=202610190018/);
  assert.match(aplicacao, /configuracoes\.js\?v=202610190062/);
  assert.match(aplicacao, /controladores\/operacao\.js\?v=202610300001/);
  assert.match(aplicacao, /controladores\/estado-visualizacao\.js\?v=202610300001/);
  assert.match(aplicacao, /componentes\/form-feedback\.js\?v=202610190001/);
  assert.doesNotMatch(aplicacao, /telas\/acesso\/acesso\.js\?v=/);
  assert.match(login, /telas\/acesso\/acesso\.js\?v=202610190036/);
  assert.match(login, /servicos\/ServicoAtivacaoLocal\.js\?v=202610190001/);
  assert.doesNotMatch(login, /ArmazenamentoTrace/);
  assert.match(aplicacao, /controladores\/acoes-administracao\.js\?v=202610190001/);
  assert.match(aplicacao, /controladores\/acoes-diagnostico\.js\?v=202610190001/);
  assert.match(aplicacao, /controladores\/acoes-cadastros\.js\?v=202610190042/);
  assert.match(aplicacao, /controladores\/acoes-interface\.js\?v=202610190042/);
  assert.match(aplicacao, /controladores\/acoes-relatorios\.js\?v=202610190043/);
  assert.match(aplicacao, /controladores\/despachante-acoes\.js\?v=202610190059/);
  assert.match(serviceWorker, /\/js\/controladores\/acoes-relatorios\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/despachante-acoes\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/registro-telas\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/status-dalas-tempo-real\.js/);
  assert.doesNotMatch(serviceWorker, /teclado-leitura-manual/);
  assert.match(serviceWorker, /\/js\/funcoes\/downloads\.js/);
  assert.match(serviceWorker, /\/js\/funcoes\/paginacao-api\.js/);
  assert.match(aplicacao, /controladores\/acoes-operacionais\.js\?v=202610190040/);
  assert.match(armazenamento, /import\("\.\.\/servicos\/ServicoInstalacoesIndustriais\.js\?v=202610190050"\)/);
  assert.match(armazenamento, /funcoes\/paginacao-api\.js\?v=202610190044/);
  assert.match(armazenamento, /OfflineOperationBuffer\.js\?v=202610190032/);
  assert.match(armazenamento, /import\("\.\.\/servicos\/ServicoAdministracaoContas\.js\?v=202610190050"\)/);
  assert.match(armazenamento, /import\("\.\.\/servicos\/ServicoRomaneios\.js\?v=202610190050"\)/);
  assert.match(armazenamento, /import\("\.\.\/servicos\/ServicoCatalogoProdutos\.js\?v=202610190050"\)/);
  assert.match(armazenamento, /import\("\.\.\/servicos\/ServicoAcoesDala\.js\?v=202610190051"\)/);
  assert.doesNotMatch(armazenamento, /^import .*Servico(?:InstalacoesIndustriais|AdministracaoContas|Romaneios|CatalogoProdutos|AcoesDala)/m);
  assert.match(armazenamento, /servicos\/ServicoDalas\.js\?v=202610190001/);
  assert.match(armazenamento, /servicos\/ServicoCarregamentoAtivo\.js\?v=202610220001/);
  assert.match(armazenamento, /servicos\/ServicoSincronizacao\.js\?v=202610300001/);
  assert.match(armazenamento, /servicos\/ServicoLeiturasOperacionais\.js\?v=202610300001/);
  assert.match(armazenamento, /servicos\/ServicoObservabilidade\.js\?v=202610190003/);
  assert.match(aplicacao, /controladores\/carregador-paginas\.js\?v=202610190041/);
  assert.match(aplicacao, /controladores\/acoes-operacionais\.js\?v=202610190040/);
  assert.match(aplicacao, /resumo-final\/resumo-final\.js\?v=202610190046/);
  assert.match(aplicacao, /controladores\/formulario-romaneio\.js\?v=202610190001/);
  assert.match(aplicacao, /controladores\/formulario-produto\.js\?v=202610190001/);
  assert.match(aplicacao, /controladores\/formulario-dala\.js\?v=202610190030/);
  assert.match(aplicacao, /controladores\/formulario-importacao-romaneio\.js\?v=202610190001/);
  const dalaFormController = readFileSync(join(raiz, "js", "controladores", "formulario-dala.js"), "utf8");
  assert.match(dalaFormController, /Validadores\.js\?v=202610190030/);
  assert.match(aplicacao, /controladores\/formularios-administrativos\.js\?v=202610190001/);
  assert.match(aplicacao, /controladores\/formularios-operacionais\.js\?v=202610300001/);
  assert.match(aplicacao, /controladores\/formularios-telas\.js\?v=202610190001/);
  assert.match(aplicacao, /controladores\/acoes-navegacao\.js\?v=202610190001/);
  assert.match(aplicacao, /controladores\/formulario-importacao-romaneio\.js\?v=202610190001/);
  assert.match(serviceWorker, /\/js\/componentes\/form-feedback\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/formulario-romaneio\.js/);
  assert.match(serviceWorker, /\/telas\/acesso\/acesso\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/formulario-produto\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/formulario-dala\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/formulario-importacao-romaneio\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/formularios-administrativos\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/formularios-operacionais\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/formularios-telas\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/acoes-navegacao\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/acoes-administracao\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/acoes-diagnostico\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/acoes-cadastros\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/acoes-operacionais\.js/);
  assert.match(serviceWorker, /\/js\/servicos\/ServicoInstalacoesIndustriais\.js/);
  assert.match(serviceWorker, /\/js\/servicos\/ServicoAdministracaoContas\.js/);
  assert.match(serviceWorker, /\/js\/servicos\/ServicoAtivacaoLocal\.js/);
  assert.match(serviceWorker, /\/js\/servicos\/ServicoRomaneios\.js/);
  assert.match(serviceWorker, /\/js\/servicos\/ServicoCatalogoProdutos\.js/);
  assert.match(serviceWorker, /\/js\/servicos\/ServicoDalas\.js/);
  assert.match(serviceWorker, /\/js\/servicos\/ServicoAcoesDala\.js/);
  assert.match(serviceWorker, /\/js\/servicos\/ServicoObservabilidade\.js/);
  assert.match(serviceWorker, /\/js\/controladores\/formulario-importacao-romaneio\.js/);
  assert.match(estadoVisualizacao, /renderStatusDalaBinario/);
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

test("a renderização inicial mantém disponível a entrada compartilhada", () => {
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  const renderPage = aplicacao.slice(
    aplicacao.indexOf("async function renderPage()"),
    aplicacao.indexOf("async function bootstrap()"),
  );
  assert.match(aplicacao, /function render\(\)\s*\{\s*renderScreen\(\);\s*\}/);
  assert.match(renderPage, /render\(\);/);
});

test("a navegação interna carrega os estilos exclusivos das telas alteradas", () => {
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  for (const path of [
    `/telas/dalas/dalas.css?v=${versaoEstiloDalas}`,
    `/telas/operacao/operacao.css?v=${versaoEstiloOperacao}`,
    `/telas/importar-romaneio/importar-romaneio.css?v=${versaoEstiloImportacao}`,
    `/telas/configuracoes/configuracoes.css?v=${versaoEstiloConfiguracoes}`,
  ]) assert.ok(aplicacao.includes(path), `estilo não registrado no roteador: ${path}`);
  assert.match(aplicacao, /ensureScreenStyles\(page\)/);
  assert.match(aplicacao, /registroTelas\.carregar\(page\)/);
});

test("ações das Dalas atualizam os estilos compartilhados com o cache correto", () => {
  const tela = readFileSync(join(raiz, "telas", "dalas", "dalas.html"), "utf8");
  const estilos = readFileSync(join(raiz, "telas", "dalas", "dalas.css"), "utf8");
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  assert.match(tela, new RegExp(`/telas/dalas/dalas\\.css\\?v=${versaoEstiloDalas}`));
  assert.match(estilos, new RegExp(`/css/responsive\\.css\\?v=${versaoEstiloResponsivo}`));
  assert.match(estilos, new RegExp(`/css/dalas-screen\\.css\\?v=${versaoEstiloDalas}`));
  for (const page of ["dalas", "dala", "dala-edit"]) {
    const chave = page === "dala-edit" ? '"dala-edit"' : page;
    assert.ok(aplicacao.includes(`${chave}: "/telas/dalas/dalas.css?v=${versaoEstiloDalas}"`));
  }
});

test("a tela inicial da operação usa o CSS com cache atualizado", () => {
  const tela = readFileSync(join(raiz, "telas", "operacao", "operacao.html"), "utf8");
  const estilos = readFileSync(join(raiz, "telas", "operacao", "operacao.css"), "utf8");
  assert.match(tela, new RegExp(`/telas/operacao/operacao\\.css\\?v=${versaoEstiloOperacao}`));
  assert.match(estilos, /\.topbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/s);
  assert.doesNotMatch(estilos, /\.topbar\s*\{[^}]*position:\s*fixed;[^}]*inset:/s);
  assert.match(estilos, /\.topbar\s*\{[^}]*height:\s*var\(--trace-topbar\)/s);
  assert.doesNotMatch(estilos, /body\.work-page:has\(\.work-operation-screen\) \.main\s*\{\s*padding-top:/);
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
  const formulariosOperacionais = readFileSync(join(raiz, "js", "controladores", "formularios-operacionais.js"), "utf8");
  const carregadorPaginas = readFileSync(join(raiz, "js", "controladores", "carregador-paginas.js"), "utf8");
  const configuracoes = readFileSync(join(raiz, "telas", "configuracoes", "configuracoes.js"), "utf8");
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  assert.doesNotMatch(operacao, /work-header-statuses/);
  assert.doesNotMatch(operacao, /emergencyPanel/);
  assert.doesNotMatch(operacao, /Registrar leitura/);
  assert.doesNotMatch(operacao, /O leitor envia Enter automaticamente|Há leituras sem código pendentes/);
  assert.match(operacao, /placeholder=\"\$\{manualReadingPlaceholder\}\"\$\{manualReadingDisabled \? \" disabled\" : \" autofocus\"\}/);
  assert.match(formulariosOperacionais, /barcodeInput\?\.addEventListener\(\"keydown\"/);
  assert.match(configuracoes, /settings-device-status-panel/);
  assert.match(operacaoCss, /@media \(min-width: 960px\) and \(min-height: 680px\) and \(max-height: 820px\)/);
  assert.match(operacaoCss, /body\.work-page:has\(\.work-operation-screen\) \{[^}]*overflow: auto;/);
  const carregamentoOperacao = carregadorPaginas.slice(
    carregadorPaginas.indexOf('work: () => ['),
    carregadorPaginas.indexOf('occurrences: () =>', carregadorPaginas.indexOf('work: () => [')),
  );
  assert.match(carregamentoOperacao, /store\.loadDeviceStatuses\(\),[\s\S]*store\.loadEquipments\(\)/);
  assert.doesNotMatch(carregamentoOperacao, /store\.loadMonitoring\(\)/);
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
