import { button, esc } from "../funcoes/html.js";
import { pageHeader } from "../funcoes/view.js";

const formatDate = (value) =>
  value ? String(value).replace(" ", " • ").split(".")[0] : "—";

function dalaStatusCell(equipment) {
  return `<td class="dala-status" data-equipment-id="${equipment.id}"><span class="status-dot"></span>Verificando…</td>`;
}

export function dalas(store) {
  const rows = store.state.equipments || [];
  const open = store.state.dalaFormOpen;
  const canDelete = ["ADMIN_DALLOGIX", "ADMIN_EMPRESA"].includes(
    store.state.userRole,
  );
  const canManage = ["ADMIN_DALLOGIX", "ADMIN_EMPRESA"].includes(
    store.state.userRole,
  );
  const form = open
    ? `<section class="panel"><h3>Nova dala</h3><form id="dala-create-form"><div class="grid three">
<label>Nome<input name="name" required /></label>
<label>Identificador<input name="equipment_code" required pattern="[a-z0-9_]{1,30}" title="Letras minúsculas, números e underscores (máx. 30)" /></label>
<label>IP do CLP<input name="plc_ip" required /></label>
<label>Porta do CLP<input name="plc_port" type="number" value="502" min="1" max="65535" required /></label>
<label>Porta externa no gateway<input name="external_port" type="number" min="1" max="65535" /></label>
</div><div class="actions">${button("Salvar", "submit-dala")}${button("Cancelar", "toggle-dala-form", "ghost")}</div></form></section><br>`
    : "";
  return `<div class="title-row with-actions"><div><h2>Dalas</h2></div>${canManage ? button(open ? "Fechar formulário" : "Nova dala", "toggle-dala-form") : ""}</div>
${form}
<section class="panel reference-table-panel"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Identificador</th><th>IP do CLP</th><th>Porta do CLP</th><th>Porta Externa</th><th>Status</th><th>Ações</th></tr></thead><tbody>
${
  rows.length
    ? rows
        .map(
          (equipment) => `<tr>
<td><strong>${esc(equipment.name)}</strong></td>
<td><code>${esc(equipment.equipment_code)}</code></td>
<td>${esc(equipment.plc_ip || "—")}</td>
<td>${equipment.plc_port || "—"}</td>
<td>${equipment.external_port || "—"}</td>
${dalaStatusCell(equipment)}
<td><button class="text-link" data-action="view-dala" data-id="${equipment.id}" type="button">Visualizar</button>${canManage ? `<button class="text-link" data-action="edit-dala" data-id="${equipment.id}" type="button">Editar</button><button class="text-link" data-action="dala-actions" data-id="${equipment.id}" type="button">Ações</button>` : ""}${canDelete ? `<button class="text-link danger-link" data-action="delete-dala" data-id="${equipment.id}" data-name="${esc(equipment.name)}" type="button">Excluir</button>` : ""}</td>
</tr>`,
        )
        .join("")
    : '<tr><td colspan="7" class="empty-cell">Nenhuma Dala cadastrada.</td></tr>'
}
</tbody></table></div></section>
<section class="panel compact-help"><strong>Comunicação</strong><p>O CLP permanece responsável pelo controle físico. O Trace acompanha o status do serviço Modbus de cada Dala através do gateway do cliente. A integração depende da definição do protocolo definitivo do serviço Dala-Modbus.</p></section>`;
}

// Tela Visualizar dala: cartões com dados cadastrais e status de comunicação.
export function dalaView(store) {
  const dala = store.state.equipmentDetail;
  if (!dala) return `${pageHeader("Cadastros / dalas", "Dala", "Carregando…")}`;
  const operation = (store.state.monitoring?.maquinas || []).find(
    (item) => Number(item.id) === Number(dala.id),
  ) || {};
  const planned = Number(operation.planned_quantity || 0);
  const loaded = Number(operation.valid_readings || 0);
  const percentage =
    planned > 0 ? Math.min(100, Math.round((loaded / planned) * 100)) : 0;
  const commands = store.state.dalaCommands || [];
  const commandRows = commands.length ? commands.map((command) => `<tr><td>#${command.id}</td><td><code>${esc(command.command)}</code></td><td>${esc(command.status)}</td><td>${esc(command.requested_at || "—")}</td><td>${esc(command.response_message || "Aguardando resposta")}</td></tr>`).join("") : '<tr><td colspan="5" class="empty-cell">Nenhum comando registrado para esta Dala.</td></tr>';
  return `<div class="title-row with-actions has-back dala-view-header"><button class="button secondary page-back" data-action="back-dala" type="button">← Voltar</button><div><h2>Dala ${esc(dala.equipment_code)}</h2></div></div>
<section class="panel"><h3>Estatísticas da Dala</h3><div class="grid four">
  <div class="metric"><small>Estado da operação</small><strong>${esc(operation.carregamento_state || "Sem operação")}</strong></div>
  <div class="metric"><small>Romaneio atual</small><strong>${esc(operation.romaneio_number ? `#${operation.romaneio_number}` : "—")}</strong></div>
  <div class="metric"><small>Carregado</small><strong>${loaded.toLocaleString("pt-BR")} / ${planned.toLocaleString("pt-BR")}</strong></div>
  <div class="metric"><small>Progresso</small><strong>${percentage}%</strong></div>
  </div><p class="muted">Último sinal: ${esc(operation.last_seen_at || "Sem sinal registrado")}</p></section><br>
<section class="panel"><p id="dala-view-status" class="dala-status-line" data-equipment-id="${dala.id}"><span class="status-dot"></span>Verificando comunicação com o serviço Modbus…</p></section><br>
<section class="panel"><div class="panel-heading"><div><h3>Diagnóstico do CLP</h3><p class="muted">Comandos enviados, status do gateway e retorno registrado.</p></div><button class="button secondary" data-action="reload-dala-diagnostics" data-id="${dala.id}" type="button">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Comando</th><th>Status</th><th>Solicitado em</th><th>Resposta</th></tr></thead><tbody>${commandRows}</tbody></table></div></section><br>
<div class="grid two detail-cards">
<div class="panel detail-card"><small>Nome</small><strong>${esc(dala.name)}</strong></div>
<div class="panel detail-card"><small>Identificador</small><strong><code>${esc(dala.equipment_code)}</code></strong></div>
<div class="panel detail-card"><small>IP do CLP</small><strong>${esc(dala.plc_ip || "—")}</strong></div>
<div class="panel detail-card"><small>Porta do CLP</small><strong>${dala.plc_port || "—"}</strong></div>
<div class="panel detail-card"><small>Porta externa no gateway</small><strong>${dala.external_port || "—"}</strong></div>
<div class="panel detail-card"><small>ID</small><strong>${dala.id}</strong></div>
<div class="panel detail-card"><small>Criada em</small><strong>${formatDate(dala.created_at)}</strong></div>
<div class="panel detail-card"><small>Atualizada em</small><strong>${formatDate(dala.updated_at)}</strong></div>
  </div>`;
}

// Tela Editar dala: mesmo formulário da criação, com dados preenchidos.
export function dalaEdit(store) {
  const dala = store.state.equipmentDetail;
  if (!dala)
    return `${pageHeader("Cadastros / dalas", "Editar dala", "Carregando…")}`;
  return `<div class="title-row with-actions has-back"><button class="button secondary page-back" data-action="view-dala" data-id="${dala.id}" type="button">← Voltar</button><div><h2>Editar dala ${esc(dala.equipment_code)}</h2></div></div>
<form id="dala-edit-form" data-id="${dala.id}">
<section class="panel"><div class="grid one">
<label>Nome<input name="name" required value="${esc(dala.name)}" /></label>
<label>Identificador<input name="equipment_code" required pattern="[a-z0-9_]{1,30}" title="Letras minúsculas, números e underscores (máx. 30)" value="${esc(dala.equipment_code)}" /><small>Letras minúsculas, números e underscores (máx. 30 caracteres)</small></label>
<label>IP do CLP<input name="plc_ip" required value="${esc(dala.plc_ip || "")}" /></label>
<label>Porta do CLP<input name="plc_port" type="number" min="1" max="65535" required value="${dala.plc_port || 502}" /></label>
<label>Porta externa no gateway<input name="external_port" type="number" min="1" max="65535" value="${dala.external_port || ""}" /><small>Porta TCP no gateway público do cliente, redirecionada para o serviço dala-modbus na edge.</small></label>
</div><div class="actions">${button("Salvar", "save-dala-edit")}</div></section>
</form>`;
}
