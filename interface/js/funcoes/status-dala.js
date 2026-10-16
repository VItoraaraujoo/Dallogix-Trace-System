import { esc } from "./html.js";

export function renderStatusDala(status) {
  const raw = String(status?.status || "DESCONHECIDO").toUpperCase();
  const tone = raw === "ONLINE" ? "online" : ["OFFLINE", "ERRO"].includes(raw) ? "offline" : "unknown";
  const label = status?.status_label || status?.message || (
    raw === "ONLINE" ? "Online" : raw === "OFFLINE" ? "Sem comunicação" : raw === "ERRO" ? "Falha de comunicação" : "Aguardando sinal"
  );
  const note = status?.configuration_note;
  return `<span class="status-dot ${tone}"></span>${esc(label)}${note ? `<br><small>${esc(note)}</small>` : ""}`;
}
