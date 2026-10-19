import assert from "node:assert/strict";
import test from "node:test";
import { criarTratadorAcoesAdministracao } from "../interface/js/controladores/acoes-administracao.js";

function prepararControlador(overrides = {}) {
  const calls = { confirmations: [], prompts: [], notifications: [], renders: 0, store: [] };
  const dependencies = {
    store: {
      setCompanyArchiveState: async (...args) => calls.store.push(["setCompanyArchiveState", ...args]),
      deleteCompany: async (...args) => calls.store.push(["deleteCompany", ...args]),
      assignIndustrialEquipment: async (...args) => calls.store.push(["assignIndustrialEquipment", ...args]),
      loadCompanyDetail: async () => calls.store.push(["loadCompanyDetail"]),
      generateIndustrialActivationCode: async (...args) => calls.store.push(["generateIndustrialActivationCode", ...args]),
      setIndustrialAccessBlocked: async (...args) => calls.store.push(["setIndustrialAccessBlocked", ...args]),
      setIndustrialInstallationArchived: async (...args) => calls.store.push(["setIndustrialInstallationArchived", ...args]),
      deleteArchivedIndustrialInstallation: async (...args) => calls.store.push(["deleteArchivedIndustrialInstallation", ...args]),
      generateCompanyActivation: async (...args) => calls.store.push(["generateCompanyActivation", ...args]),
      updateLicense: async (...args) => calls.store.push(["updateLicense", ...args]),
      updateUser: async (...args) => calls.store.push(["updateUser", ...args]),
    },
    confirmarAcao: async (message) => {
      calls.confirmations.push(message);
      return true;
    },
    solicitarTexto: async (message) => {
      calls.prompts.push(message);
      return message.startsWith("Digite sua senha") ? "senha-atual" : "Empresa A";
    },
    notificar: (message) => calls.notifications.push(message),
    render: () => { calls.renders += 1; },
    copiarTexto: async (text) => calls.clipboard = text,
    ...overrides,
  };
  return { calls, tratar: criarTratadorAcoesAdministracao(dependencies) };
}

test("arquivar empresa mantém confirmação, persistência e feedback", async () => {
  const { calls, tratar } = prepararControlador();
  assert.equal(await tratar("archive-company", { dataset: { id: "8", name: "Empresa A" } }), true);
  assert.match(calls.confirmations[0], /Arquivar a empresa "Empresa A"/);
  assert.deepEqual(calls.store, [["setCompanyArchiveState", "8", true]]);
  assert.deepEqual(calls.notifications, ["Empresa arquivada. Os dados foram preservados."]);
  assert.equal(calls.renders, 1);
});

test("exclusão definitiva repete a autenticação na confirmação de dados vinculados", async () => {
  let tentativas = 0;
  const { calls, tratar } = prepararControlador({
    store: {
      deleteCompany: async (...args) => {
        calls.store.push(["deleteCompany", ...args]);
        tentativas += 1;
        if (tentativas === 1) throw Object.assign(new Error("Há dados vinculados."), { status: 409 });
      },
    },
  });

  assert.equal(await tratar("delete-company-permanently", { dataset: { id: "8", name: "Empresa A" } }), true);
  assert.equal(calls.store.length, 2);
  assert.deepEqual(calls.store[0], ["deleteCompany", "8", {
    permanent: true,
    password: "senha-atual",
    confirmation: "Empresa A",
  }]);
  assert.deepEqual(calls.store[1], ["deleteCompany", "8", {
    permanent: true,
    force: true,
    password: "senha-atual",
    confirmation: "Empresa A",
  }]);
  assert.match(calls.confirmations[1], /apagar também todos os dados arquivados/);
  assert.deepEqual(calls.notifications, ["Empresa e dados vinculados excluídos definitivamente."]);
  assert.equal(calls.renders, 1);
});

test("vínculo de PC industrial exige uma Dala selecionada", async () => {
  const { calls, tratar } = prepararControlador();
  const node = { closest: () => ({ dataset: { installationId: "pc-3" }, elements: { namedItem: () => ({ value: "" }) } }) };
  assert.equal(await tratar("link-industrial-pc-dala", node), true);
  assert.deepEqual(calls.store, []);
  assert.deepEqual(calls.notifications, ["Selecione a Dala que pertence a este PC industrial."]);
});

test("ações de usuário preservam empresa, confirmação e validação mínima da senha", async () => {
  let password = "12345";
  const { calls, tratar } = prepararControlador({
    store: {
      state: { userRole: "ADMIN_DALLOGIX", selectedCompanyId: 12 },
      updateUser: async (payload) => calls.store.push(["updateUser", payload]),
    },
    solicitarTexto: async () => password,
  });
  const userNode = { dataset: { id: "7", name: "Operador", role: "USUARIO", active: "1" } };

  assert.equal(await tratar("toggle-user", userNode), true);
  assert.deepEqual(calls.store[0], ["updateUser", {
    id: "7", name: "Operador", role: "USUARIO", active: false, company_id: 12,
  }]);
  assert.match(calls.confirmations[0], /Desativar o login de Operador/);

  await tratar("reset-user-password", userNode);
  assert.equal(calls.store.length, 1);
  assert.deepEqual(calls.notifications.at(-1), "A senha deve ter pelo menos 6 caracteres.");

  password = "senha-forte";
  await tratar("reset-user-password", userNode);
  assert.deepEqual(calls.store[1], ["updateUser", {
    id: "7", name: "Operador", role: "USUARIO", active: true,
    password: "senha-forte", company_id: 12,
  }]);
  assert.deepEqual(calls.notifications.at(-1), "Senha atualizada.");
});

test("ações desconhecidas não são consumidas pelo controlador administrativo", async () => {
  const { tratar } = prepararControlador();
  assert.equal(tratar("ação-de-outra-tela", { dataset: {} }), false);
  assert.equal(await tratar("ação-de-outra-tela", { dataset: {} }), false);
});
