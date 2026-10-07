import assert from "node:assert/strict";
import test from "node:test";
import { createSettingsStatusController } from "../interface/js/controladores/status-configuracoes.js";
import { apresentacaoStatusDispositivo, settings } from "../interface/telas/configuracoes/configuracoes.js";

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
  globalThis.document = { hidden: false };
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

test("status têm apresentação clara para online, offline, erro e ausência de sinal", () => {
  assert.deepEqual(apresentacaoStatusDispositivo("ONLINE"), {
    online: true, tone: "online", label: "ON", detail: "Sinal recebido",
  });
  assert.equal(apresentacaoStatusDispositivo("OFFLINE").label, "OFF");
  assert.equal(apresentacaoStatusDispositivo("ERRO").tone, "error");
  assert.equal(apresentacaoStatusDispositivo("DESCONHECIDO").tone, "unknown");
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
  assert.match(markup, /data-device-summary="attention-count">3<\/strong><span data-device-summary="attention-label">sem sinal/);
  assert.match(markup, /class="dala-status" data-equipment-id="4"><span class="status-dot online"><\/span>Online/);
  assert.doesNotMatch(markup, /Verificando…/);
  assert.doesNotMatch(markup, /Atualizado em|Atualizado \d/);
});

test("status de Configurações atualizam por polling sem redesenhar a tela", async () => {
  const ambiente = criarAmbiente();
  let pagina = "settings";
  let monitoramentos = 0;
  let sincronizacoes = 0;
  let dalas = 0;
  let atualizacoes = 0;
  const store = {
    async loadMonitoring() { monitoramentos += 1; },
    async loadSyncStatus() { sincronizacoes += 1; },
    async loadDalaStatuses() { dalas += 1; },
  };
  const controller = createSettingsStatusController({
    store,
    getPage: () => pagina,
    refreshView: () => { atualizacoes += 1; },
    intervalMs: 5000,
    hiddenIntervalMs: 15000,
  });

  try {
    controller.start();
    assert.equal(ambiente.tarefa.delay, 5000);
    const callback = ambiente.tarefa.callback;
    callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual([monitoramentos, sincronizacoes, dalas, atualizacoes], [1, 1, 1, 1]);
    assert.equal(ambiente.tarefa.delay, 5000);
    controller.stop();
    assert.equal(ambiente.limpas.length, 1);
  } finally {
    controller.stop();
    ambiente.restaurar();
  }
});

test("poll de Configurações não atualiza uma tela após navegar para outro lugar", async () => {
  const ambiente = criarAmbiente();
  let pagina = "settings";
  let liberarConsulta;
  let atualizacoes = 0;
  const consulta = new Promise((resolve) => { liberarConsulta = resolve; });
  const store = {
    loadMonitoring: () => consulta,
    async loadSyncStatus() {},
    async loadDalaStatuses() {},
  };
  const controller = createSettingsStatusController({
    store,
    getPage: () => pagina,
    refreshView: () => { atualizacoes += 1; },
  });

  try {
    controller.start();
    ambiente.tarefa.callback();
    pagina = "work";
    controller.stop();
    liberarConsulta();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(atualizacoes, 0);
    assert.equal(ambiente.tarefa, null);
  } finally {
    controller.stop();
    ambiente.restaurar();
  }
});
