import assert from "node:assert/strict";
import test from "node:test";
import { alerts } from "../interface/telas/alertas/alertas.js";

test("alertas exibe a idade da fila e a fila morta", () => {
  const html = alerts({
    state: {
      monitoring: { leituras: {}, dispositivos: [], maquinas: [] },
      syncStatus: {
        summary: { PENDENTE: 2, PROCESSANDO: 1, ERRO: 1, ENVIADO: 4 },
        recent: [],
        remote_configured: true,
        queue_health: {
          oldest_at: "2026-10-06 12:00:00",
          stale: true,
          dead_letter_pending: 3,
        },
        central_sync: { configured: true, central_url_configured: true, installation_registered: true },
      },
    },
  });

  assert.match(html, /Evento mais antigo/);
  assert.match(html, /Acima do limite configurado/);
  assert.match(html, /Fila morta/);
  assert.match(html, />3<\/strong>/);
});

