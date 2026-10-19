import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { criarCarregadorPaginas } from "../interface/js/controladores/carregador-paginas.js";
import { renderDalaStatuses } from "../interface/js/controladores/operacao.js";
import { renderStatusDala } from "../interface/js/funcoes/status-dala.js";
import { dalas } from "../interface/telas/dalas/dalas.js";
import { dashboard } from "../interface/telas/painel/painel.js";
import { dalaView } from "../interface/telas/visualizar-dala/visualizar-dala.js";
import { errorLogs } from "../interface/telas/logs-erros/logs-erros.js";

const applicationCode = readFileSync(new URL("../interface/js/aplicacao.js", import.meta.url), "utf8");
const reportActionsCode = readFileSync(new URL("../interface/js/controladores/acoes-relatorios.js", import.meta.url), "utf8");

test("status da Dala mostra ON/OFF e não reutiliza mensagens técnicas longas", () => {
  const mensagem = "Dala ociosa; sem retorno de movimento configurado.";
  const online = renderStatusDala({ status: "ONLINE", status_label: mensagem, message: mensagem });
  const offline = renderStatusDala({ status: "OFFLINE", status_label: mensagem, message: mensagem });
  const error = renderStatusDala({ status: "ERRO", message: mensagem });
  const unknown = renderStatusDala({ status: "DESCONHECIDO", message: mensagem });

  assert.match(online, /aria-label="CLP online"[^>]*>ON<\/span>/);
  assert.match(offline, />OFF<\/span>/);
  assert.match(error, />OFF<\/span>/);
  assert.match(unknown, />—<\/span>/);
  for (const markup of [online, offline, error, unknown]) {
    assert.doesNotMatch(markup, /Dala ociosa|movimento configurado/);
  }
});

test("atualização ao vivo mantém o status compacto na lista de Dalas", () => {
  const originalDocument = globalThis.document;
  const cell = { dataset: { equipmentId: "7" } };
  globalThis.document = { querySelectorAll: () => [cell], querySelector: () => null };

  try {
    renderDalaStatuses({ state: { dalaStatuses: [{
      equipment_id: 7,
      status: "ONLINE",
      message: "Dala ociosa; sem retorno de movimento configurado.",
    }] } });
    assert.match(cell.innerHTML, />ON<\/span>/);
    assert.doesNotMatch(cell.innerHTML, /movimento|ociosa/);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("cabeçalho Ações permanece centralizado sem mover os botões", () => {
  const css = readFileSync(new URL("../interface/css/dalas-screen.css", import.meta.url), "utf8");
  assert.match(css, /\.dalas-screen-v2 \.dala-grid-head-v2 > div:last-child\s*\{\s*text-align:\s*center;/);
  assert.match(css, /\.dalas-screen-v2 \.dala-actions-v2 > \.dala-action-v2/);
});

test("diagnóstico da Dala pagina o histórico e explica a retenção", () => {
  const markup = dalaView({ state: {
    equipmentDetail: { id: 7, name: "Esteira", equipment_code: "esteira_1", plc_ip: "192.168.1.10", plc_port: 502 },
    dalaStatuses: [],
    dalaCommands: [{ id: 1, command: "ESTEIRA_LIGAR", status: "APLICADO", requested_at: "2026-10-16 10:00:00" }],
    dalaCommandsPagination: { page: 2, per_page: 30, total: 61, pages: 3 },
  } });
  assert.match(markup, /rotina diária não apaga estes comandos/);
  assert.match(markup, /zerar a empresa remove o histórico dela/);
  assert.match(markup, /páginas de 30/);
  assert.match(markup, /dala-command-page/);
  assert.match(markup, /data-page="3"/);
});

test("Dashboard usa status das Dalas sem carregar o snapshot de métricas", () => {
  const markup = dashboard({ state: {
    equipments: [{ id: 7, name: "Esteira", equipment_code: "esteira_1" }],
    equipmentsLoaded: true,
    equipmentsError: "",
    userRole: "ADMIN_EMPRESA",
    dalaStatuses: [{
      id: 7,
      clp_status: "ONLINE",
      status: "ONLINE",
      last_seen_at: "2026-10-19 12:00:00",
      carregamento_state: "CARREGANDO",
      planned_quantity: 10,
      valid_readings: 4,
      romaneio_number: "ROM-34",
      plate: "ABC1D23",
      physical_running: true,
      operational_status: "OPERANDO",
      carregamento_id: 21,
      romaneio_id: 34,
    }],
  } });

  assert.match(markup, /4 \/ 10/);
  assert.match(markup, /#ROM-34/);
  assert.match(markup, /ABC1D23/);
  assert.match(markup, /badge green">Em operação/);
});

test("Dashboard e detalhe da Dala atualizam status sem pedir o snapshot agregado", async () => {
  const calls = [];
  const store = {
    state: { equipmentsError: "" },
    loadEquipments(options) { calls.push(["loadEquipments", options]); return Promise.resolve(); },
    loadDalaStatuses() { calls.push(["loadDalaStatuses"]); return Promise.resolve(); },
    loadEquipment(id) { calls.push(["loadEquipment", id]); return Promise.resolve(); },
    loadDalaCommandHistory(id) { calls.push(["loadDalaCommandHistory", id]); return Promise.resolve(); },
  };
  const loader = criarCarregadorPaginas({
    store,
    obterPerfil: () => "ADMIN_EMPRESA",
    obterModoInstalacao: () => "local",
    idDaConsulta: () => 7,
    registrarAviso() {},
  });

  await loader.carregarDadosIniciais("dashboard");
  assert.deepEqual(calls.map(([name]) => name), ["loadEquipments", "loadDalaStatuses"]);
  calls.length = 0;
  await Promise.all(loader.obterConsultasAoVivo("dashboard"));
  assert.deepEqual(calls.map(([name]) => name), ["loadDalaStatuses", "loadEquipments"]);
  assert.deepEqual(calls[1][1], { force: false });
  assert.doesNotMatch(calls.map(([name]) => name).join(" "), /loadMonitoring/);

  calls.length = 0;
  await loader.carregarDadosIniciais("dala");
  assert.deepEqual(calls.map(([name]) => name), ["loadEquipment", "loadDalaCommandHistory", "loadDalaStatuses"]);
  assert.doesNotMatch(calls.map(([name]) => name).join(" "), /loadMonitoring/);
});

test("Operação e emergência usam status recente do CLP sem snapshot histórico", async () => {
  const calls = [];
  const store = new Proxy({ state: {} }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => { calls.push([property, ...args]); return Promise.resolve(); };
    },
  });
  const loader = criarCarregadorPaginas({
    store,
    obterPerfil: () => "ADMIN_EMPRESA",
    obterModoInstalacao: () => "local",
    idDaConsulta: () => 7,
    registrarAviso() {},
  });
  const commandConfirmation = applicationCode.match(/const machineCommandQueue = createMachineCommandQueue\(\{([\s\S]*?)\n\}\);/)?.[1] || "";
  await loader.carregarDadosIniciais("work");
  assert.ok(calls.some(([name]) => name === "loadDeviceStatuses"));
  assert.ok(!calls.some(([name]) => name === "loadMonitoring"));
  calls.length = 0;
  await loader.carregarDadosIniciais("emergency");
  assert.ok(calls.some(([name]) => name === "loadDeviceStatuses"));
  assert.ok(!calls.some(([name]) => name === "loadMonitoring"));
  assert.match(commandConfirmation, /loadDeviceStatuses\(\)/);
  assert.doesNotMatch(commandConfirmation, /loadMonitoring\(\)/);
  assert.match(reportActionsCode, /await store\.loadSyncStatus\(\)/);
  assert.match(reportActionsCode, /Sincronização pendente/);
  assert.match(reportActionsCode, /syncSummary\[status\]/);
});

test("painel técnico informa fontes centralizadas, limites e lacunas dos logs", () => {
  const markup = errorLogs({ state: {
    errorLogs: [],
    errorLogsPagination: { page: 1, per_page: 100, total: 0, pages: 1 },
    errorLogRetentionDays: 365,
    technicalDiagnostics: { queue: {}, disk: {}, devices: [], commands: [] },
    deadLetters: [],
  } });
  assert.match(markup, /resumo mostra os 10 mais recentes/);
  assert.match(markup, /até 100 registros|100 registro/);
  assert.match(markup, /falhas do navegador, exceções PHP registradas e transições OFFLINE\/ERRO dos dispositivos/);
  assert.match(markup, /logs brutos do Docker, Nginx, MySQL/);
  assert.match(markup, /retenção automática: 365 dias/);
  assert.match(markup, /Nenhum registro encontrado neste histórico/);
});

test("logs antigos ficam acessíveis por páginas", () => {
  const markup = errorLogs({ state: {
    errorLogs: [{ id: 101, origem: "frontend.aviso", mensagem: "Falha", criado_em: "2026-10-16 10:00:00" }],
    errorLogsPagination: { page: 2, per_page: 100, total: 250, pages: 3 },
    errorLogRetentionDays: 365,
    technicalDiagnostics: {},
    deadLetters: [],
  } });
  assert.match(markup, /error-logs-page/);
  assert.match(markup, /250 registro\(s\) · página 2 de 3/);
  assert.match(markup, /data-page="3"/);
});

test("o status inicial da lista não tenta exibir explicação longa", () => {
  const markup = dalas({ state: {
    equipments: [{ id: 7, name: "Esteira", equipment_code: "esteira_1", plc_ip: "192.168.1.10", plc_port: 502 }],
    equipmentsError: "",
    equipmentsLoaded: true,
    equipmentsLoading: false,
    dalaFormOpen: false,
    userRole: "USUARIO",
  } });
  assert.match(markup, /aria-label="Verificando comunicação do CLP"/);
  assert.match(markup, /dala-status-label unknown"[^>]*>—<\/span>/);
  assert.doesNotMatch(markup, /Sem retorno de movimento configurado/);
});

test("polling local reutiliza o cadastro e revalida o heartbeat no Central ou após falha", async () => {
  const calls = [];
  const store = {
    state: { equipmentsError: "" },
    loadEquipments(options) { calls.push(options); return Promise.resolve(); },
    loadDalaStatuses() { return Promise.resolve(); },
  };
  let installationMode = "local";
  const loader = criarCarregadorPaginas({
    store,
    obterPerfil: () => "ADMIN_EMPRESA",
    obterModoInstalacao: () => installationMode,
    idDaConsulta: () => 7,
    registrarAviso() {},
  });

  await Promise.all(loader.obterConsultasAoVivo("dalas"));
  assert.deepEqual(calls.at(-1), { force: false });

  installationMode = "central";
  await Promise.all(loader.obterConsultasAoVivo("dalas"));
  assert.deepEqual(calls.at(-1), { force: true });

  installationMode = "local";
  store.state.equipmentsError = "Falha temporária";
  await Promise.allSettled(loader.obterConsultasAoVivo("dalas"));
  assert.deepEqual(calls.at(-1), { force: true });
});
