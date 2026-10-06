import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const raiz = join(process.cwd(), "interface");
const versao = "202610060011";

test("o shell invalida cache quando a aplicação muda", () => {
  const serviceWorker = readFileSync(join(raiz, "service-worker.js"), "utf8");
  const aplicacao = readFileSync(join(raiz, "js", "aplicacao.js"), "utf8");
  assert.match(serviceWorker, /trace-shell-20261006-11/);
  assert.match(aplicacao, new RegExp(`/service-worker\\.js\\?v=${versao}`));
  assert.match(aplicacao, new RegExp(`ArmazenamentoTrace\\.js\\?v=${versao}`));
  assert.match(aplicacao, new RegExp(`operacao\\.js\\?v=${versao}`));
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
    assert.match(readFileSync(path, "utf8"), new RegExp(`/js/aplicacao\\.js\\?v=${versao}`), path);
  }
});
