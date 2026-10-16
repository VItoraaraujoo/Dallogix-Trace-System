import assert from "node:assert/strict";
import test from "node:test";
import { createPageRefreshController } from "../interface/js/controladores/page-refresh.js";
import { renderDalaStatuses } from "../interface/js/controladores/operacao.js";
import { renderStatusDala } from "../interface/js/funcoes/status-dala.js";
import { apresentacaoConectividadePc, apresentacaoStatusDispositivo, settings } from "../interface/telas/configuracoes/configuracoes.js";

function criarAmbiente() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let tarefa = null;
  const limpas = [];
  globalThis.window = {
    setTimeout(callback, delay) {
      const id = Symbol("timer");
      const disparar = () => {
        if (tarefa?.id === id) tarefa = null;
        return callback();
      };
      tarefa = { callback: disparar, delay, id };
      return id;
    },
    clearTimeout(id) {
      limpas.push(id);
      if (tarefa?.id === id) tarefa = null;
    },
  };
  globalThis.document = { hidden: false, addEventListener() {} };
  return {
    get tarefa() { return tarefa; },
    limpas,
    restaurar() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createSettingsController({ load, refresh, getPage = () => "settings" }) {
  return createPageRefreshController({
    getPage,
    pages: new Map([["settings", {
      load,
      refresh,
      intervalMs: 5000,
      hiddenIntervalMs: 15000,
    }]]),
  });
}

test("status têm apresentação clara para online, offline, erro e ausência de sinal", () => {
  assert.deepEqual(apresentacaoStatusDispositivo("ONLINE"), {
    online: true, tone: "online", label: "ON", detail: "Sinal recebido",
  });
  assert.equal(apresentacaoStatusDispositivo("OFFLINE").label, "OFF");
  assert.equal(apresentacaoStatusDispositivo("ERRO").tone, "error");
  assert.equal(apresentacaoStatusDispositivo("DESCONHECIDO").tone, "unknown");
  assert.deepEqual(apresentacaoStatusDispositivo("NAO_REGISTRADO", "SENSOR"), {
    online: false, tone: "unknown", label: "NÃO MONITORADO", detail: "Sem monitoramento automático",
  });
  assert.equal(apresentacaoStatusDispositivo("NAO_REGISTRADO", "SCANNER").label, "NÃO MONITORADO");
  assert.equal(apresentacaoStatusDispositivo("NAO_REGISTRADO", "CAMERA").label, "SEM SINAL");
});

test("Configurações mostra cartões próprios e status vinculados à Dala", () => {
  const markup = settings({ state: {
    configuration: { settings: {}, dalas: [{ id: 4, name: "Dala 4", equipment_code: "EST-04" }] },
    monitoring: { dispositivos: [{ device_type: "SENSOR", status: "ONLINE", equipment_id: 4 }] },
    equipments: [{ id: 4, equipment_code: "EST-04" }],
    syncStatus: { central_sync: { configured: true, installation_registered: true, pc_status: "ONLINE" } },
    dalaStatuses: [{ equipment_id: 4, status: "ONLINE", message: "Online" }],
    serverStatus: "ONLINE",
    userRole: "USUARIO",
  } });
  assert.match(markup, /settings-device-status-card online/);
  assert.match(markup, /data-device-status-card="SENSOR" data-live-status-equipment="4"/);
  assert.match(markup, /EST-04/);
  assert.match(markup, /data-device-summary="online-count"/);
  assert.match(markup, /data-device-summary="attention-count">3<\/strong><span data-device-summary="attention-label">sem confirmação online/);
  assert.match(markup, /class="dala-status" data-equipment-id="4"><span class="status-dot online"><\/span>Online/);
  assert.doesNotMatch(markup, /Verificando…/);
  assert.doesNotMatch(markup, /Atualizado em|Atualizado \d/);
});

test("sensor e scanner sem produtor aparecem como não monitorados", () => {
  const markup = settings({ state: {
    configuration: { settings: {}, dalas: [] },
    monitoring: { dispositivos: [] },
    equipments: [],
    syncStatus: null,
    dalaStatuses: [],
    serverStatus: "DESCONHECIDO",
    userRole: "USUARIO",
  } });
  assert.match(markup, /data-device-status-card="SENSOR"[\s\S]*?NÃO MONITORADO/);
  assert.match(markup, /data-device-status-card="SCANNER"[\s\S]*?NÃO MONITORADO/);
  assert.match(markup, /data-device-status-card="CAMERA"[\s\S]*?SEM SINAL/);
});

test("conectividade do PC descreve o sinal recebido pelo Central", () => {
  assert.deepEqual(apresentacaoConectividadePc({
    central_sync: { configured: true, installation_registered: true, pc_status: "OFFLINE" },
  }), ["offline", "Central sem comunicação recente com o PC"]);
  assert.deepEqual(apresentacaoConectividadePc({
    central_sync: { configured: false, installation_registered: true, pc_status: "ONLINE" },
  }), ["unknown", "Sincronização central não configurada"]);
});

test("status da Dala separa comunicação de observação de configuração", () => {
  const markup = renderStatusDala({
    status: "ONLINE",
    message: "Dala ociosa; sem retorno de movimento configurado.",
    status_label: "Dala ociosa.",
    configuration_note: "Sem retorno de movimento configurado.",
  });
  assert.match(markup, /status-dot online/);
  assert.match(markup, /Dala ociosa\.<br><small>Sem retorno de movimento configurado\.<\/small>/);
  assert.equal(renderStatusDala({ status: "OFFLINE", message: "Sem comunicação" }),
    '<span class="status-dot offline"></span>Sem comunicação');
  for (const tag of ["script", "SCRIPT"]) {
    const escapedMarkup = renderStatusDala({
      status: "ONLINE", status_label: "Online", configuration_note: `<${tag}>erro</${tag}>`,
    });
    assert.ok(escapedMarkup.includes(`&lt;${tag}&gt;erro&lt;/${tag}&gt;`));
  }
});

test("lista e detalhe da Dala mostram a observação sem associá-la ao ponto verde", () => {
  const originalDocument = globalThis.document;
  const listCell = { dataset: { equipmentId: "4" }, innerHTML: "" };
  const detailCell = { dataset: { equipmentId: "4" }, innerHTML: "" };
  globalThis.document = {
    querySelectorAll: () => [listCell],
    querySelector: () => detailCell,
  };
  try {
    renderDalaStatuses({ state: { dalaStatuses: [{
      equipment_id: 4,
      status: "ONLINE",
      status_label: "Dala ociosa.",
      configuration_note: "Sem retorno de movimento configurado.",
    }] } });
    assert.match(listCell.innerHTML, /status-dot online/);
    assert.match(listCell.innerHTML, /Dala ociosa\.<br><small>Sem retorno de movimento configurado\.<\/small>/);
    assert.equal(detailCell.innerHTML, listCell.innerHTML);
    renderDalaStatuses({ state: { dalaStatuses: [] } }, new Error("Consulta indisponível"));
    assert.match(listCell.innerHTML, /status-dot unknown/);
    assert.doesNotMatch(listCell.innerHTML, /Sem retorno de movimento/);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("controlador genérico atualiza Configurações e respeita intervalos", async () => {
  const ambiente = criarAmbiente();
  let pagina = "settings";
  let consultas = 0;
  let atualizacoes = 0;
  const controller = createSettingsController({
    getPage: () => pagina,
    load: async () => { consultas += 1; },
    refresh: () => { atualizacoes += 1; },
  });

  try {
    controller.start();
    assert.equal(ambiente.tarefa.delay, 5000);
    ambiente.tarefa.callback();
    await flush();
    assert.deepEqual([consultas, atualizacoes], [1, 1]);
    assert.equal(ambiente.tarefa.delay, 5000);

    globalThis.document.hidden = true;
    ambiente.tarefa.callback();
    await flush();
    assert.equal(ambiente.tarefa.delay, 15000);
    controller.stop();
    assert.ok(ambiente.limpas.length > 0);
  } finally {
    controller.stop();
    ambiente.restaurar();
  }
});

test("status só fica desatualizado depois de duas consultas consecutivas com falha", async () => {
  const ambiente = criarAmbiente();
  let falhas = 0;
  const freshness = [];
  const controller = createSettingsController({
    load: async () => { falhas += 1; throw new Error("Sem conexão"); },
    refresh: (state) => freshness.push(state),
  });

  try {
    controller.start();
    ambiente.tarefa.callback();
    await flush();
    assert.equal(freshness[0].stale, false);
    assert.equal(freshness[0].consecutiveFailures, 1);
    ambiente.tarefa.callback();
    await flush();
    assert.equal(freshness[1].stale, true);
    assert.equal(freshness[1].consecutiveFailures, 2);
    assert.ok(freshness[1].staleForMs >= 0);
    assert.equal(falhas, 2);
  } finally {
    controller.stop();
    ambiente.restaurar();
  }
});

test("resposta atrasada não redesenha Configurações depois da navegação", async () => {
  const ambiente = criarAmbiente();
  let pagina = "settings";
  let liberarConsulta;
  let atualizacoes = 0;
  const consulta = new Promise((resolve) => { liberarConsulta = resolve; });
  const controller = createSettingsController({
    getPage: () => pagina,
    load: () => consulta,
    refresh: () => { atualizacoes += 1; },
  });

  try {
    controller.start();
    ambiente.tarefa.callback();
    pagina = "work";
    controller.stop();
    liberarConsulta();
    await flush();
    assert.equal(atualizacoes, 0);
    assert.equal(ambiente.tarefa, null);
  } finally {
    controller.stop();
    ambiente.restaurar();
  }
});
