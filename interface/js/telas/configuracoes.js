import { button, esc } from "../funcoes/html.js";
import { pageHeader } from "../funcoes/view.js?v=202609220100";

// Configurações no padrão da referência: Rede do cliente, Dalas (somente leitura)
// e parâmetros da importação de romaneios (PDF).
export function settings(store) {
  const config = store.state.configuration || { settings: {}, dalas: [] };
  const saved = config.settings || {};
  const sync = store.state.syncStatus || {};
  const centralSync = sync.central_sync || {};
  const pcOnline = Boolean(centralSync.pc_online);
  const syncTone = pcOnline ? "online" : "offline";
  const syncLabel = pcOnline ? "PC industrial online" : "PC industrial offline";
  const dalaStatuses = Array.isArray(store.state.dalaStatuses)
    ? store.state.dalaStatuses
    : [];
  const totalDalas = config.dalas.length;
  const onlineDalas = dalaStatuses.filter((dala) => dala.status === "ONLINE").length;
  const dalaTone = totalDalas > 0 && onlineDalas === totalDalas ? "online" : totalDalas > 0 ? "offline" : "";
  const dalaLabel = totalDalas === 0
    ? "Máquinas/Dalas não cadastradas"
    : onlineDalas === totalDalas
      ? "Máquinas/Dalas online"
      : "Máquinas/Dalas offline";
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
            `<tr><td>${esc(dala.name)}</td><td><code>${esc(dala.equipment_code)}</code></td><td>${esc(dala.plc_ip || "—")}</td><td>${dala.plc_port || "—"}</td><td>${dala.external_port || "—"}</td><td class="dala-status" data-equipment-id="${dala.id}"><span class="status-dot"></span>Verificando…</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6" class="empty-cell">Nenhuma Dala cadastrada.</td></tr>';
  const canManageUsers = ["ADMIN_DALLOGIX", "ADMIN_EMPRESA"].includes(
    store.state.userRole,
  );
  return `<div class="title-row"><div><h2>Configurações</h2></div></div>
${canManageUsers ? `<section class="panel settings-access-panel"><div class="panel-heading"><div><h3>Gerenciar usuários</h3><p>Crie e gerencie os usuários, perfis e acessos da empresa.</p></div>${button("Abrir gerenciamento de usuários", "open-users", "primary")}</div></section><br>` : ""}
<section class="panel"><h3>Rede do cliente</h3>
<p>Configure o IP público do gateway do cliente. O Trace usará esse endereço com a porta externa de cada Dala para alcançar o serviço dala-modbus na fábrica.</p>
<form id="network-form"><label>IP público do gateway<input name="gateway_public_ip" value="${esc(saved.gateway_public_ip || "")}" placeholder="170.80.219.146" /><small>IP fixo ou DDNS do modem/roteador do cliente.</small></label>
<div class="actions">${button("Salvar configuração", "save-network")}</div></form></section><br>
<section class="panel"><h3>Conectividade</h3><div class="sync-status-row"><span class="status-dot ${syncTone}"></span><strong>${syncLabel}</strong></div><br><div class="sync-status-row"><span class="status-dot ${dalaTone}"></span><strong>${dalaLabel}</strong></div></section><br>
<section class="panel"><div class="panel-heading"><h3>Dalas</h3><div class="actions">${button("Recarregar", "reload-dalas", "secondary")}${button("Gerenciar Dalas", "goto-dalas")}</div></div>
<p>Visão consolidada das Dalas cadastradas e do status de comunicação com o serviço dala-modbus. A tabela abaixo é somente leitura — para cadastrar ou editar, use Gerenciar Dalas.</p>
<p><strong>Identificador:</strong> código único da Dala (letras minúsculas, números e underscores). Deve coincidir com o ID configurado no dala-modbus na fábrica para que comandos e verificação de status funcionem.</p>
<p><strong>IP do CLP:</strong> endereço IP do CLP na rede local da fábrica (ex.: 192.168.1.10). <strong>Porta do CLP:</strong> porta TCP do CLP para Modbus (geralmente 502). <strong>Porta Externa:</strong> porta TCP aberta no gateway público do cliente, redirecionada para o serviço dala-modbus na edge.</p>
<div class="table-wrap settings-dalas-table-wrap"><table class="settings-dalas-table"><thead><tr><th>Nome da Dala</th><th>Identificador da Dala</th><th>IP do CLP</th><th>Porta do CLP</th><th>Porta Externa</th><th>Status</th></tr></thead><tbody>${dalaRows}</tbody></table></div></section><br>
<section class="panel pdf-import-panel"><div class="panel-heading pdf-import-heading"><div><h3>Importação de romaneios (PDF)</h3><p class="compact-help">Informe apenas os nomes dos campos que existem no PDF. <b class="required">*</b> Obrigatório.</p></div></div>
<form id="pdf-settings-form"><div class="pdf-import-fields">
${fields.map(([key, label, required]) => `<label>${label}${required ? ' <b class="required">*</b>' : ""}<input name="pdf_${key}" value="${esc(mapping[key] || "")}" placeholder="Nome do campo no PDF" /></label>`).join("")}
</div>
<div class="pdf-import-footer"><label>Buscar produtos por <b class="required">*</b><select name="pdf_search_field"><option value="barcode"${searchField === "barcode" ? " selected" : ""}>Código de barras</option><option value="sku"${searchField === "sku" ? " selected" : ""}>SKU</option></select></label><div class="actions">${button("Salvar parâmetros", "save-pdf-settings")}</div></div></form></section>`;
}
