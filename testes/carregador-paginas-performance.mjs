import assert from "node:assert/strict";
import test from "node:test";
import { criarCarregadorPaginas } from "../interface/js/controladores/carregador-paginas.js";

test("a abertura da Operação não consulta a lista de romaneios não exibida", async () => {
  const calls = [];
  const store = {
    state: { selectedLoadingId: null },
    async loadActiveLoading() { calls.push("active-loading"); },
    async loadPendingReadings() { calls.push("pending-readings"); },
    async loadDeviceStatuses() { calls.push("device-statuses"); },
    async loadEquipments() { calls.push("equipments"); },
    async loadManifests() { calls.push("manifests"); },
  };
  const loader = criarCarregadorPaginas({
    store,
    obterPerfil: () => "OPERADOR",
    obterModoInstalacao: () => "local",
    idDaConsulta: () => null,
    registrarAviso: () => {},
  });

  await loader.carregarDadosIniciais("work");

  assert.deepEqual(new Set(calls), new Set([
    "active-loading",
    "pending-readings",
    "device-statuses",
    "equipments",
  ]));
  assert.equal(calls.includes("manifests"), false);
});
