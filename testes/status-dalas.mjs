import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderDalaStatuses } from "../interface/js/controladores/operacao.js";
import { renderStatusDala } from "../interface/js/funcoes/status-dala.js";
import { dalas } from "../interface/telas/dalas/dalas.js";
import { dalaView } from "../interface/telas/visualizar-dala/visualizar-dala.js";
import { errorLogs } from "../interface/telas/logs-erros/logs-erros.js";

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
  assert.match(css, /\.dala-grid-cell-v2:nth-child\(7\)\s*\{\s*text-align:\s*right;/);
  assert.match(css, /\.dala-grid-head-v2>div:nth-child\(7\)\s*\{\s*text-align:\s*center;/);
});

test("diagnóstico de Dala informa que a consulta mostra até 30 comandos e não pagina", () => {
  const markup = dalaView({ state: {
    equipmentDetail: { id: 7, name: "Esteira", equipment_code: "esteira_1", plc_ip: "192.168.1.10", plc_port: 502 },
    monitoring: { maquinas: [] },
    dalaCommands: [{ id: 1, command: "ESTEIRA_LIGAR", status: "APLICADO", requested_at: "2026-10-16 10:00:00" }],
  } });
  assert.match(markup, /no máximo 30 comandos recentes/);
  assert.match(markup, /não pagina o histórico/);
});

test("painel técnico informa o limite e as fontes de log ausentes", () => {
  const markup = errorLogs({ state: {
    errorLogs: [],
    technicalDiagnostics: { queue: {}, disk: {}, devices: [], commands: [] },
    deadLetters: [],
  } });
  assert.match(markup, /no máximo 10 comandos recentes/);
  assert.match(markup, /até 100 registros de logs_erros/);
  assert.match(markup, /Logs brutos do PHP, Docker, Node-RED e camera-worker não são agregados/);
  assert.match(markup, /Nenhum registro encontrado neste histórico/);
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
