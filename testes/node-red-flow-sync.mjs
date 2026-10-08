import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { syncManagedFlow } = require("../integracoes/node-red/sync-managed-flow.js");
const seedPath = new URL("../integracoes/node-red/trace-clp-bridge.flow.json", import.meta.url);
const seed = JSON.parse(readFileSync(seedPath, "utf8"));

test("atualiza a aba gerenciada, preserva abas locais e cria backup", () => {
  const directory = mkdtempSync(join(tmpdir(), "trace-flow-sync-"));
  try {
    const flowPath = join(directory, "flows.json");
    const oldFlow = seed.map((node) => node.id === "command-safe-gate" ? { ...node, func: "versão antiga" } : node);
    oldFlow.push({ id: "operator-tab", type: "tab", label: "Fluxo do operador" });
    oldFlow.push({ id: "operator-node", type: "inject", z: "operator-tab", wires: [] });
    writeFileSync(flowPath, JSON.stringify(oldFlow));

    const result = syncManagedFlow(flowPath, seedPath);
    assert.equal(result.action, "updated-managed-tab");
    assert.deepEqual(JSON.parse(readFileSync(result.backupPath, "utf8")), oldFlow);
    const updated = JSON.parse(readFileSync(flowPath, "utf8"));
    assert.equal(updated.find((node) => node.id === "command-safe-gate").func,
      seed.find((node) => node.id === "command-safe-gate").func);
    assert.ok(updated.some((node) => node.id === "operator-tab"));
    assert.ok(updated.some((node) => node.id === "operator-node"));

    assert.equal(syncManagedFlow(flowPath, seedPath).action, "unchanged");
    assert.equal(readdirSync(directory).filter((name) => name.includes(".backup-")).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preserva fluxo sem aba gerenciada pelo Trace", () => {
  const directory = mkdtempSync(join(tmpdir(), "trace-flow-sync-"));
  try {
    const flowPath = join(directory, "flows.json");
    const operatorFlow = [{ id: "operator-tab", type: "tab", label: "Fluxo do operador" }];
    writeFileSync(flowPath, JSON.stringify(operatorFlow));
    assert.equal(syncManagedFlow(flowPath, seedPath).action, "preserved-unmanaged-flow");
    assert.deepEqual(JSON.parse(readFileSync(flowPath, "utf8")), operatorFlow);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("não substitui Flow 1 quando ele contém nós do operador", () => {
  const directory = mkdtempSync(join(tmpdir(), "trace-flow-sync-"));
  try {
    const flowPath = join(directory, "flows.json");
    const operatorFlow = [
      { id: "operator-tab", type: "tab", label: "Flow 1" },
      { id: "operator-inject", type: "inject", z: "operator-tab", wires: [] },
    ];
    writeFileSync(flowPath, JSON.stringify(operatorFlow));

    assert.equal(syncManagedFlow(flowPath, seedPath).action, "preserved-unmanaged-flow");
    assert.deepEqual(JSON.parse(readFileSync(flowPath, "utf8")), operatorFlow);
    assert.equal(readdirSync(directory).some((name) => name.includes(".backup-")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("semeia o fluxo Trace quando o único Flow 1 está realmente vazio", () => {
  const directory = mkdtempSync(join(tmpdir(), "trace-flow-sync-"));
  try {
    const flowPath = join(directory, "flows.json");
    const placeholder = [{ id: "placeholder-tab", type: "tab", label: "Flow 1" }];
    writeFileSync(flowPath, JSON.stringify(placeholder));

    const result = syncManagedFlow(flowPath, seedPath);
    assert.equal(result.action, "seeded-placeholder");
    assert.deepEqual(JSON.parse(readFileSync(result.backupPath, "utf8")), placeholder);
    assert.ok(JSON.parse(readFileSync(flowPath, "utf8")).some((node) => node.id === "trace-clp-bridge"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("semeia o fluxo Trace sobre o aviso padrão da imagem Node-RED", () => {
  const directory = mkdtempSync(join(tmpdir(), "trace-flow-sync-"));
  try {
    const flowPath = join(directory, "flows.json");
    const placeholder = [
      { id: "placeholder-tab", type: "tab", label: "Flow 1" },
      {
        id: "default-warning",
        type: "comment",
        z: "placeholder-tab",
        name: "WARNING: please check you have started this container with a volume that is mounted to /data\\n otherwise any flow changes are lost when you redeploy or upgrade the container\\n (e.g. upgrade to a more recent node-red docker image).\\n  If you are using named volumes you can ignore this warning.\\n Double click or see info side panel to learn how to start Node-RED in Docker to save your work",
        info: "The default Node-RED Docker volume warning mentions a volume mounted to /data.",
      },
    ];
    writeFileSync(flowPath, JSON.stringify(placeholder));

    const result = syncManagedFlow(flowPath, seedPath);
    assert.equal(result.action, "seeded-placeholder");
    assert.deepEqual(JSON.parse(readFileSync(result.backupPath, "utf8")), placeholder);
    assert.ok(JSON.parse(readFileSync(flowPath, "utf8")).some((node) => node.id === "trace-clp-bridge"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("instalador e Compose fornecem ao gateway as chaves do mapa com padrão bloqueado", () => {
  const machineConfig = JSON.parse(readFileSync(new URL("../implantacao/windows/machine-config.example.json", import.meta.url), "utf8"));
  const installer = readFileSync(new URL("../implantacao/windows/Install-TraceMachine.ps1", import.meta.url), "utf8");
  const setup = readFileSync(new URL("../implantacao/windows/Setup-TraceMachine.ps1", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const gate = JSON.stringify(seed.find((node) => node.id === "command-safe-gate").func);

  assert.equal(machineConfig.physical_clp_enabled, false);
  assert.equal(machineConfig.io_map_status, "APPROVED");
  assert.deepEqual(machineConfig.modbus_map, {
    conveyor_run_coil: 2049,
    reverse_command_coil: 2050,
    emergency_command_coil: 2051,
    emergency_feedback_coil: 17,
  });
  assert.match(setup, /Ask "Modelo do CLP \(digite INVT TS621 para selecionar o mapa aprovado\)" ""/);
  assert.match(setup, /Confirma que esta Dala usa o mapa aprovado: motor M2049, reversão M2050, emergência M2051 e retorno M17\? \(S\/N\)" "N"/);
  assert.match(setup, /if \(\$approvedMapConfirmed -and \$equipmentId -gt 0\)/);
  assert.match(setup, /io_map_status = if \(\$approvedMapConfirmed\) \{ "APPROVED" \}/);
  assert.match(setup, /emergency_feedback_coil = if \(\$approvedMapConfirmed\) \{ 17 \}/);
  assert.match(setup, /Habilitar comandos físicos usando o mapa aprovado deste INVT TS621\? \(S\/N\)" "N"/);
  for (const variable of [
    "TRACE_PHYSICAL_CLP_ENABLED",
    "TRACE_IO_MAP_STATUS",
    "TRACE_MODBUS_MAP_EQUIPMENT_ID",
    "TRACE_MODBUS_COIL_CONVEYOR_RUN",
    "TRACE_MODBUS_COIL_REVERSAL",
    "TRACE_MODBUS_COIL_EMERGENCY",
    "TRACE_MODBUS_COIL_EMERGENCY_FEEDBACK",
  ]) {
    assert.ok(installer.includes(variable), `instalador não gera ${variable}`);
    assert.ok(gate.includes(variable), `gateway não valida ${variable}`);
  }
  assert.match(compose, /config\/node-red-clp\.env[\s\S]*required:\s*false/);
});
