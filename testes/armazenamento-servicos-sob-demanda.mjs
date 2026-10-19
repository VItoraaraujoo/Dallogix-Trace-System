import assert from "node:assert/strict";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

function criarArmazenamentoIsolado() {
  const armazenamento = Object.create(ArmazenamentoTrace.prototype);
  armazenamento.servicosCarregando = new Map();
  return armazenamento;
}

test("serviços de cadastro não são criados até o domínio ser acessado", async () => {
  const armazenamento = new ArmazenamentoTrace();
  const chaves = [
    "servicoRomaneios",
    "servicoCatalogoProdutos",
    "servicoAdministracaoContas",
    "servicoInstalacoesIndustriais",
    "servicoAcoesDala",
  ];
  assert.ok(chaves.every((chave) => !(chave in armazenamento)));

  const servicos = await Promise.all([
    armazenamento.obterServicoRomaneios(),
    armazenamento.obterServicoCatalogoProdutos(),
    armazenamento.obterServicoAdministracaoContas(),
    armazenamento.obterServicoInstalacoesIndustriais(),
    armazenamento.obterServicoAcoesDala(),
  ]);

  assert.deepEqual(servicos.map((servico) => servico.constructor.name), [
    "ServicoRomaneios",
    "ServicoCatalogoProdutos",
    "ServicoAdministracaoContas",
    "ServicoInstalacoesIndustriais",
    "ServicoAcoesDala",
  ]);
  assert.ok(chaves.every((chave) => armazenamento[chave]));
});

test("o serviço é compartilhado durante importações concorrentes e fica em cache", async () => {
  const armazenamento = criarArmazenamentoIsolado();
  let chamadasImportacao = 0;
  let resolverImportacao;
  const importar = () => {
    chamadasImportacao += 1;
    return new Promise((resolve) => { resolverImportacao = resolve; });
  };
  const criar = ({ nome }) => ({ nome });

  const primeira = armazenamento.obterServicoSobDemanda("servicoTeste", importar, criar);
  const segunda = armazenamento.obterServicoSobDemanda("servicoTeste", importar, criar);

  assert.strictEqual(primeira, segunda);
  assert.equal(chamadasImportacao, 1);
  resolverImportacao({ nome: "contas" });

  const [servicoPrimeiro, servicoSegundo] = await Promise.all([primeira, segunda]);
  assert.strictEqual(servicoPrimeiro, servicoSegundo);
  assert.strictEqual(armazenamento.servicoTeste, servicoPrimeiro);
  assert.equal(armazenamento.servicosCarregando.size, 0);

  const servicoEmCache = await armazenamento.obterServicoSobDemanda(
    "servicoTeste",
    () => { throw new Error("não deveria importar novamente"); },
    criar,
  );
  assert.strictEqual(servicoEmCache, servicoPrimeiro);
});

test("uma falha de importação libera a chave pendente para nova tentativa", async () => {
  const armazenamento = criarArmazenamentoIsolado();
  const falha = new Error("módulo temporariamente indisponível");

  await assert.rejects(
    armazenamento.obterServicoSobDemanda(
      "servicoTeste",
      () => Promise.reject(falha),
      (modulo) => modulo,
    ),
    falha,
  );
  assert.equal(armazenamento.servicosCarregando.size, 0);

  const esperado = { pronto: true };
  const recuperado = await armazenamento.obterServicoSobDemanda(
    "servicoTeste",
    async () => esperado,
    (modulo) => modulo,
  );
  assert.strictEqual(recuperado, esperado);
  assert.strictEqual(armazenamento.servicoTeste, esperado);
});

test("uma instância injetada continua sendo usada sem importação", async () => {
  const armazenamento = criarArmazenamentoIsolado();
  const existente = { nome: "serviço de teste" };
  armazenamento.servicoTeste = existente;

  const resultado = await armazenamento.obterServicoSobDemanda(
    "servicoTeste",
    () => { throw new Error("serviço injetado não deve ser importado"); },
    (modulo) => modulo,
  );

  assert.strictEqual(resultado, existente);
});
