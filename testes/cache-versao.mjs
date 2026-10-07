import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const raiz = join(process.cwd(), "interface");
const versaoAplicacao = "202610071720";
const versaoTela = "202610071720";
const versaoEstilo = "202610070203";

test("o shell invalida cache quando a aplicação muda", () => {
  const serviceWorker = readFileSync(join(raiz, "service-worker.js"), "utf8");
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  assert.match(serviceWorker, /trace-shell-20261007-04/);
  assert.match(aplicacao, new RegExp(`/service-worker\\.js\\?v=${versaoAplicacao}`));
  assert.match(aplicacao, new RegExp(`ArmazenamentoTrace\\.js\\?v=${versaoTela}`));
  assert.match(aplicacao, new RegExp(`operacao\\.js\\?v=${versaoTela}`));
  assert.match(aplicacao, new RegExp(`importar-romaneio\\.js\\?v=${versaoTela}`));
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
    assert.match(readFileSync(path, "utf8"), new RegExp(`/js/aplicacao\\.js\\?v=${versaoAplicacao}`), path);
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
    `/telas/operacao/operacao.css?v=${versaoEstilo}`,
    `/telas/importar-romaneio/importar-romaneio.css?v=${versaoEstilo}`,
    `/telas/configuracoes/configuracoes.css?v=${versaoEstilo}`,
  ]) assert.ok(aplicacao.includes(path), `estilo não registrado no roteador: ${path}`);
  assert.match(aplicacao, /await ensureScreenStyles\(currentPage\)/);
});

test("Novo romaneio referencia o CSS alinhado com cache versionado", () => {
  const tela = readFileSync(join(raiz, "telas", "importar-romaneio", "importar-romaneio.html"), "utf8");
  const estilos = readFileSync(join(raiz, "telas", "importar-romaneio", "importar-romaneio.css"), "utf8");
  assert.match(tela, new RegExp(`/telas/importar-romaneio/importar-romaneio\\.css\\?v=${versaoEstilo}`));
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
  assert.match(aplicacao, /settingsRealtime\.start\(\)/);
  assert.match(aplicacao, /settingsRealtime\.stop\(\)/);
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
  assert.match(notificacoes, /export function notificar\(\)\s*\{\s*return null;\s*\}/);
  assert.doesNotMatch(operacaoCss, /#trace-notificacoes/);
});
