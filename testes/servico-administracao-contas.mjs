import assert from "node:assert/strict";
import test from "node:test";
import { ServicoAdministracaoContas } from "../interface/js/servicos/ServicoAdministracaoContas.js";

function criarServico(overrides = {}) {
  const calls = { requests: [], pageLoads: [], installationLoads: 0 };
  const state = {
    userRole: "ADMIN_DALLOGIX",
    selectedCompanyId: 8,
    companies: [],
    users: [],
    companyActivation: null,
    localActivation: null,
    companyDetail: null,
  };
  const responses = [...(overrides.responses || [])];
  const api = {
    async fetch(url, options = {}) {
      calls.requests.push({ url, options });
      return responses.shift() || { payload: { data: { saved: true } } };
    },
  };
  const servico = new ServicoAdministracaoContas({
    api,
    state,
    jsonHeaders: () => ({ "X-CSRF-Token": "csrf-test" }),
    jsonResponse: async (response) => {
      if (response.error) throw response.error;
      return response.payload;
    },
    fetchAllPages: async (path) => {
      calls.pageLoads.push(path);
      if (overrides.fetchAllPages) return overrides.fetchAllPages(path);
      return path.startsWith("/api/usuarios.php")
        ? [{ id: 2, name: "Zeca" }, { id: 1, name: "Ana" }]
        : [{ id: 2, name: "Zeta" }, { id: 1, name: "Alfa" }];
    },
    loadIndustrialInstallations: async () => { calls.installationLoads += 1; },
  });
  return { calls, state, servico };
}

test("listas de empresas e usuários preservam filtro, paginação e ordenação", async () => {
  const { calls, state, servico } = criarServico();

  await servico.loadCompanies();
  await servico.loadUsers();

  assert.deepEqual(calls.pageLoads, [
    "/api/empresas.php?include_archived=1",
    "/api/usuarios.php?company_id=8",
  ]);
  assert.deepEqual(state.companies.map(({ name }) => name), ["Alfa", "Zeta"]);
  assert.deepEqual(state.users.map(({ name }) => name), ["Ana", "Zeca"]);
});

test("admin Dallogix mantém lista vazia quando a API não tem empresa selecionada", async () => {
  const { state, servico } = criarServico({
    fetchAllPages: async () => { throw Object.assign(new Error("filtro obrigatório"), { status: 422 }); },
  });

  await servico.loadUsers();

  assert.deepEqual(state.users, []);
});

test("criar usuário associa a empresa selecionada somente para admin Dallogix", async () => {
  const { calls, servico } = criarServico({
    responses: [{ payload: { data: { id: 34 } } }],
  });

  const result = await servico.createUser({ name: "Operador", role: "USUARIO" });

  assert.deepEqual(result, { id: 34 });
  assert.deepEqual(JSON.parse(calls.requests[0].options.body), {
    name: "Operador",
    role: "USUARIO",
    company_id: 8,
  });
  assert.equal(calls.requests[0].options.headers["X-CSRF-Token"], "csrf-test");
});

test("atualizar usuário recarrega a lista da empresa atual", async () => {
  const { calls, state, servico } = criarServico({
    responses: [{ payload: { data: { id: 34, updated: true } } }],
  });

  const result = await servico.updateUser({ id: 34, name: "Operador" });

  assert.deepEqual(result, { id: 34, updated: true });
  assert.deepEqual(calls.pageLoads, ["/api/usuarios.php?company_id=8"]);
  assert.deepEqual(state.users.map(({ name }) => name), ["Ana", "Zeca"]);
});

test("ações de empresa mantêm métodos, payloads, atualizações e estado da licença", async () => {
  const { calls, state, servico } = criarServico({
    responses: [
      { payload: { data: { code: "CRIADA" } } },
      { payload: { data: { code: "GERADA" } } },
      { payload: { data: { id: 8, name: "Empresa Nova" } } },
      { payload: { data: { id: 8, archived: true } } },
      { payload: { data: { id: 8, deleted: true } } },
      { payload: { data: { license: "atualizada" } } },
    ],
  });

  assert.deepEqual(await servico.createCompany({ name: "Empresa" }), { code: "CRIADA" });
  assert.deepEqual(await servico.generateCompanyActivation("8"), { code: "GERADA" });
  assert.deepEqual(await servico.renameCompany("8", " Empresa Nova "), {
    id: 8,
    name: "Empresa Nova",
  });
  assert.deepEqual(await servico.setCompanyArchiveState("8", true), {
    id: 8,
    archived: true,
  });
  assert.deepEqual(await servico.deleteCompany("8", {
    force: true,
    permanent: true,
    confirmation: "Empresa",
    password: "senha",
  }), { id: 8, deleted: true });
  assert.deepEqual(await servico.updateLicense({ company_id: 8, days: 30 }), {
    license: "atualizada",
  });

  assert.deepEqual(calls.requests.map(({ options }) => options.method), [
    "POST", "POST", "PUT", "PUT", "DELETE", "PUT",
  ]);
  assert.deepEqual(JSON.parse(calls.requests[1].options.body), {
    action: "generate_activation_code",
    company_id: 8,
  });
  assert.deepEqual(JSON.parse(calls.requests[2].options.body), {
    id: 8,
    name: "Empresa Nova",
  });
  assert.deepEqual(JSON.parse(calls.requests[3].options.body), {
    id: 8,
    action: "archive",
  });
  assert.match(calls.requests[4].url, /force=1.*permanent=1/);
  assert.deepEqual(JSON.parse(calls.requests[4].options.body), {
    confirmation: "Empresa",
    password: "senha",
  });
  assert.equal(state.companyActivation, null);
  assert.equal(calls.pageLoads.length, 4, "renomear, arquivar, excluir e licenciar recarregam empresas");
});

test("ativação local e detalhe da empresa preservam respostas e atualizam as Dalas", async () => {
  const { calls, state, servico } = criarServico({
    responses: [
      { payload: { data: { active: false } } },
      { payload: { data: { active: true } } },
      { payload: { data: { id: 8, name: "Empresa" } } },
    ],
  });

  assert.deepEqual(await servico.loadLocalActivation(), { active: false });
  assert.deepEqual(await servico.activateLocalInstallation({ code: "123456" }), {
    active: true,
  });
  await servico.loadCompanyDetail();

  assert.equal(state.companyDetail.name, "Empresa");
  assert.equal(calls.installationLoads, 1);
  assert.equal(calls.requests[0].options.cache, "no-store");
  assert.deepEqual(JSON.parse(calls.requests[1].options.body), { code: "123456" });
  assert.equal(calls.requests[2].url, "/api/empresas.php?company_id=8");
});

test("selecionar empresa atualiza a chave usada pelos carregamentos seguintes", () => {
  const { state, servico } = criarServico();

  servico.selectCompany("12");

  assert.equal(state.selectedCompanyId, 12);
});
