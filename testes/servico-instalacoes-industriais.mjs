import assert from "node:assert/strict";
import test from "node:test";
import { ServicoInstalacoesIndustriais } from "../interface/js/servicos/ServicoInstalacoesIndustriais.js";

function criarServico({ respostaPagina, respostaAcao } = {}) {
  const requests = [];
  const state = {
    selectedCompanyId: 42,
    industrialInstallations: [],
    industrialEquipmentOptions: [],
    industrialInstallationActivation: { code: "anterior" },
  };
  const api = {
    async fetch(url, options = {}) {
      requests.push({ url, options });
      if (options.method === "POST") {
        return { payload: respostaAcao || { data: { success: true } } };
      }
      const page = new URL(url, "http://trace.local");
      return {
        payload: respostaPagina
          ? respostaPagina(page, requests.length)
          : {
              data: { installations: [], equipment_options: [] },
              pagination: { has_more: false },
              equipment_pagination: { has_more: false },
            },
      };
    },
  };
  const servico = new ServicoInstalacoesIndustriais({
    api,
    state,
    jsonHeaders: () => ({ "Content-Type": "application/json" }),
    jsonResponse: async (response) => response.payload,
    validarCursorPaginacao(pagination, currentCursor) {
      if (!pagination || typeof pagination.has_more !== "boolean") {
        throw new Error("metadados de paginação inválidos");
      }
      if (!pagination.has_more) return null;
      const next = Number(pagination.next_cursor);
      if (!Number.isSafeInteger(next) || next <= currentCursor) {
        throw new Error("cursor inválido");
      }
      return next;
    },
  });
  return { requests, state, servico };
}

test("carrega e ordena listas com paginação independente de Dalas e instalações", async () => {
  const { requests, state, servico } = criarServico({
    respostaPagina(url) {
      if (url.searchParams.get("cursor") === "0") {
        return {
          data: {
            installations: [{ id: 2, name: "Beta" }],
            equipment_options: [{ id: 20, name: "Zeta" }],
          },
          pagination: { has_more: true, next_cursor: 2 },
          equipment_pagination: { has_more: true, next_cursor: 20 },
        };
      }
      return {
        data: {
          installations: [{ id: 1, name: "Alfa" }],
          equipment_options: [{ id: 10, name: "Alfa" }],
        },
        pagination: { has_more: false },
        equipment_pagination: { has_more: false },
      };
    },
  });

  const result = await servico.loadIndustrialInstallations();

  assert.deepEqual(requests.map(({ url }) => {
    const parsed = new URL(url, "http://trace.local");
    return [parsed.searchParams.get("cursor"), parsed.searchParams.get("equipment_cursor")];
  }), [["0", "0"], ["2", "20"]]);
  assert.deepEqual(result.installations.map(({ name }) => name), ["Alfa", "Beta"]);
  assert.deepEqual(result.equipment_options.map(({ name }) => name), ["Alfa", "Zeta"]);
  assert.equal(state.industrialInstallations, result.installations);
  assert.equal(state.industrialEquipmentOptions, result.equipment_options);
});

test("bloquear acesso envia ação correta, limpa ativação e atualiza as listas", async () => {
  const { requests, state, servico } = criarServico({
    respostaAcao: { data: { installation_id: 7 } },
  });

  const result = await servico.setIndustrialAccessBlocked(7, true);

  assert.deepEqual(result, { installation_id: 7 });
  assert.equal(JSON.parse(requests[0].options.body).action, "block_access");
  assert.equal(JSON.parse(requests[0].options.body).installation_id, 7);
  assert.equal(state.industrialInstallationActivation, null);
  assert.equal(requests.length, 2);
  assert.deepEqual(state.industrialInstallations, []);
});

test("ações de PCs industriais preservam payloads, mensagens de estado e recarga", async (t) => {
  const casos = [
    {
      nome: "cadastrar",
      acao: "create",
      executar: (servico) => servico.createIndustrialInstallation("  PC Linha 1  "),
      payload: { action: "create", company_id: 42, name: "PC Linha 1" },
      ativacaoEsperada: { code: "anterior" },
    },
    {
      nome: "vincular Dala",
      acao: "assign_equipment",
      executar: (servico) => servico.assignIndustrialEquipment("7", "9"),
      payload: { action: "assign_equipment", installation_id: 7, equipment_id: 9 },
      ativacaoEsperada: { code: "anterior" },
    },
    {
      nome: "revogar acesso",
      acao: "revoke_access",
      executar: (servico) => servico.revokeIndustrialAccess("7"),
      payload: { action: "revoke_access", installation_id: 7 },
      ativacaoEsperada: null,
    },
    {
      nome: "bloquear acesso",
      acao: "block_access",
      executar: (servico) => servico.setIndustrialAccessBlocked("7", true),
      payload: { action: "block_access", installation_id: 7 },
      ativacaoEsperada: null,
    },
    {
      nome: "liberar acesso",
      acao: "unblock_access",
      executar: (servico) => servico.setIndustrialAccessBlocked("7", false),
      payload: { action: "unblock_access", installation_id: 7 },
      ativacaoEsperada: null,
    },
    {
      nome: "arquivar",
      acao: "archive",
      executar: (servico) => servico.setIndustrialInstallationArchived("7", true),
      payload: { action: "archive", installation_id: 7 },
      ativacaoEsperada: null,
    },
    {
      nome: "restaurar",
      acao: "restore_archive",
      executar: (servico) => servico.setIndustrialInstallationArchived("7", false),
      payload: { action: "restore_archive", installation_id: 7 },
      ativacaoEsperada: null,
    },
    {
      nome: "excluir arquivado",
      acao: "delete_archived",
      executar: (servico) => servico.deleteArchivedIndustrialInstallation("7"),
      payload: { action: "delete_archived", installation_id: 7 },
      ativacaoEsperada: null,
    },
    {
      nome: "gerar código",
      acao: "generate_activation_code",
      executar: (servico) => servico.generateIndustrialActivationCode("7"),
      payload: { action: "generate_activation_code", installation_id: 7 },
      ativacaoEsperada: { code: "novo" },
    },
  ];

  for (const caso of casos) {
    await t.test(caso.nome, async () => {
      const { requests, state, servico } = criarServico({
        respostaAcao: { data: { code: "novo" } },
      });

      const result = await caso.executar(servico);

      assert.deepEqual(result, { code: "novo" });
      assert.deepEqual(JSON.parse(requests[0].options.body), caso.payload);
      assert.deepEqual(state.industrialInstallationActivation, caso.ativacaoEsperada);
      assert.equal(requests[0].options.headers["Content-Type"], "application/json");
      assert.equal(requests.length, 2, "a lista deve ser atualizada após a ação");
    });
  }
});

test("consulta de instalações exige uma empresa selecionada", async () => {
  const { servico, state, requests } = criarServico();
  state.selectedCompanyId = null;

  await assert.rejects(
    servico.loadIndustrialInstallations(),
    /Nenhuma empresa selecionada/,
  );
  assert.equal(requests.length, 0);
});

test("limita a paginação a 10 mil registros para evitar carga ilimitada na tela", async () => {
  const { requests, servico } = criarServico({
    respostaPagina(_url, requestNumber) {
      return {
        data: { installations: [], equipment_options: [] },
        pagination: { has_more: true, next_cursor: requestNumber },
        equipment_pagination: { has_more: false },
      };
    },
  });

  await assert.rejects(
    servico.loadIndustrialInstallations(),
    /ultrapassa 10\.000 registros/,
  );
  assert.equal(requests.length, 100);
});
