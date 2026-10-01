import { button, esc } from "../../js/funcoes/html.js";
import { pageHeader } from "../../js/funcoes/view.js?v=202609280006";

// Conectividade local/remota, Dalas (somente leitura) e importação de PDF.
export function settings(store) {
  const config = store.state.configuration || { settings: {}, dalas: [] };
  const saved = config.settings || {};
  const sync = store.state.syncStatus || {};
  const centralSync = sync.central_sync || {};
  const pcStatus = String(
    centralSync.pc_status || (centralSync.pc_online ? "ONLINE" : "DESCONHECIDO"),
  ).toUpperCase();
  const pcPresentation = !store.state.syncStatus
    ? ["unknown", "Status da sincronização indisponível"]
    : !centralSync.configured
      ? ["unknown", "Sincronização central não configurada"]
      : !centralSync.installation_registered
        ? ["unknown", "Instalação ainda não registrada"]
        : {
            ONLINE: ["online", "PC industrial online"],
            OFFLINE: ["offline", "PC industrial sem comunicação"],
            ERRO: ["offline", "PC industrial com erro"],
            DESCONHECIDO: ["unknown", "PC industrial sem sinal"],
          }[pcStatus] || ["unknown", "Status do PC industrial desconhecido"];
  const [syncTone, syncLabel] = pcPresentation;
  const dalaStatuses = Array.isArray(store.state.dalaStatuses)
    ? store.state.dalaStatuses
    : [];
  const totalDalas = config.dalas.length;
  const onlineDalas = dalaStatuses.filter((dala) => dala.status === "ONLINE").length;
  const offlineDalas = dalaStatuses.filter((dala) => ["OFFLINE", "ERRO"].includes(dala.status)).length;
  const unknownDalas = Math.max(0, totalDalas - onlineDalas - offlineDalas);
  const dalaTone = totalDalas === 0 || unknownDalas > 0 || (onlineDalas > 0 && offlineDalas > 0)
    ? "unknown"
    : offlineDalas > 0
      ? "offline"
      : "online";
  const dalaLabel = totalDalas === 0
    ? "Dalas não cadastradas"
    : onlineDalas === totalDalas
      ? "Dalas online"
      : offlineDalas === totalDalas
        ? "Dalas sem comunicação"
        : onlineDalas > 0
          ? "Dalas parcialmente online"
          : "Dalas sem status";
  const mapping = saved.pdf_field_mapping || {};
  const searchField = saved.pdf_search_field || "barcode";
  const fields = [
    ["codigo", "Código", false],
    ["data", "Data do carregamento", false],
    ["expedidor", "Expedidor", false],
    ["placa", "Placa do caminhão", false],
    ["motorista", "Motorista", false],
    ["produto", "Identificador do produto", true],
    ["quantidade", "Quantidade", true],
  ];
  const dalaRows = config.dalas.length
    ? config.dalas
        .map(
          (dala) =>
            `<tr><td>${esc(dala.name)}</td><td><code>${esc(dala.equipment_code)}</code></td><td>${esc(dala.plc_ip || "—")}</td><td>${dala.plc_port || "—"}</td><td class="dala-status" data-equipment-id="${dala.id}"><span class="status-dot"></span>Verificando…</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="empty-cell">Nenhuma Dala cadastrada.</td></tr>';
  const canManageUsers = ["ADMIN_DALLOGIX", "ADMIN_EMPRESA"].includes(
    store.state.userRole,
  );
  return `<div class="title-row"><div><h2>Configurações</h2></div></div>
${canManageUsers ? `<section class="panel settings-access-panel"><div class="panel-heading"><div><h3>Gerenciar usuários</h3><p>Crie e gerencie os usuários, perfis e acessos da empresa.</p></div>${button("Abrir gerenciamento de usuários", "open-users", "primary")}</div></section><br>` : ""}
<section class="panel"><h3>Comunicação industrial</h3><p>O PC industrial acessa o CLP pela rede local e inicia a sincronização HTTPS com o servidor central. Não é necessário abrir porta pública ou configurar redirecionamento no roteador.</p></section><br>
<section class="panel"><h3>Conectividade</h3><div class="sync-status-row"><span class="status-dot ${syncTone}"></span><strong>${syncLabel}</strong></div><br><div class="sync-status-row"><span class="status-dot ${dalaTone}"></span><strong>${dalaLabel}</strong></div></section><br>
<section class="panel"><div class="panel-heading"><h3>Dalas</h3><div class="actions">${button("Recarregar", "reload-dalas", "secondary")}${button("Gerenciar Dalas", "goto-dalas")}</div></div>
<p>Visão consolidada das Dalas cadastradas e do último sinal Modbus recebido do PC industrial. Para cadastrar ou editar, use Gerenciar Dalas.</p>
<p><strong>Identificador:</strong> código único da Dala. <strong>IP do CLP:</strong> endereço na rede local da fábrica. <strong>Porta do CLP:</strong> porta TCP Modbus informada pelo fabricante.</p>
<div class="table-wrap settings-dalas-table-wrap"><table class="settings-dalas-table"><thead><tr><th>Nome da Dala</th><th>Identificador da Dala</th><th>IP do CLP</th><th>Porta do CLP</th><th>Status</th></tr></thead><tbody>${dalaRows}</tbody></table></div></section><br>
<section class="panel pdf-import-panel"><div class="panel-heading pdf-import-heading"><div><h3>Importação de romaneios (PDF)</h3><p class="compact-help">Informe apenas os nomes dos campos que existem no PDF. <b class="required">*</b> Obrigatório.</p></div></div>
<form id="pdf-settings-form"><div class="pdf-import-fields">
${fields.map(([key, label, required]) => `<label>${label}${required ? ' <b class="required">*</b>' : ""}<input name="pdf_${key}" value="${esc(mapping[key] || "")}" placeholder="Nome do campo no PDF" /></label>`).join("")}
</div>
<div class="pdf-import-footer"><label>Buscar produtos por <b class="required">*</b><select name="pdf_search_field"><option value="barcode"${searchField === "barcode" ? " selected" : ""}>Código de barras</option><option value="sku"${searchField === "sku" ? " selected" : ""}>SKU</option></select></label><div class="actions">${button("Salvar parâmetros", "save-pdf-settings")}</div></div></form></section>`;
}
