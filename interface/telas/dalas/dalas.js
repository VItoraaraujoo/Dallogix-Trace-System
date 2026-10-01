import { dataHora, numero } from "../../js/funcoes/formato.js?v=202609170930";
import { button, esc } from "../../js/funcoes/html.js";
import { rotuloComando, rotuloEstado, rotuloEvento, rotuloStatusComando } from "../../js/funcoes/rotulos.js";
import { pageHeader, physicalStateBadge } from "../../js/funcoes/view.js?v=202609280006";

function dalaStatusCell(equipment) {
  return `<div class="dala-status" data-equipment-id="${equipment.id}"><span class="status-dot"></span>Verificando…</div>`;
}

function dalaReferenceActions(equipment, canManage, canDelete) {
  const actions = [
    `<button data-action="view-dala" data-id="${equipment.id}" type="button">Visualizar</button>`,
    canManage ? `<button data-action="edit-dala" data-id="${equipment.id}" type="button">Editar</button>` : "",
    canManage ? `<button data-action="dala-actions" data-id="${equipment.id}" type="button">Ações</button>` : "",
    canDelete ? `<button class="danger" data-action="delete-dala" data-id="${equipment.id}" data-name="${esc(equipment.name)}" type="button">Excluir</button>` : "",
  ].filter(Boolean);
  const withClass = (item) => item.includes('class="danger"')
    ? item.replace('class="danger"', 'class="dala-action-v2 danger"')
    : item.replace("<button ", '<button class="dala-action-v2" ');
  return `<div class="dala-actions-v2">${actions.map(withClass).join("")}</div>`;
}

export function dalas(store) {
  const rows = store.state.equipments || [];
  const loadError = store.state.equipmentsError;
  const loading = !store.state.equipmentsLoaded || store.state.equipmentsLoading;
  const open = store.state.dalaFormOpen;
  const canDelete = store.state.userRole === "ADMIN_EMPRESA";
  const canManage = store.state.userRole === "ADMIN_EMPRESA";
  if (open) {
    return `<div class="dala-create-screen"><div class="title-row has-back"><button class="button secondary page-back" data-action="toggle-dala-form" type="button">← Voltar</button><div><h2>Nova Dala</h2><p>Cadastre a comunicação da Dala com o CLP e o gateway.</p></div></div>
<section class="panel dala-create-panel"><form id="dala-create-form"><div class="grid one">
<label>Nome da Dala<input name="name" autocomplete="off" required /></label>
<label>Identificador<input name="equipment_code" autocomplete="off" required pattern="[a-z0-9_]{1,30}" title="Letras minúsculas, números e underscores (máx. 30)" /><small>Use letras minúsculas, números e underscore. Máximo de 30 caracteres.</small></label>
<label>Endereço do CLP (IP ou nome)<input name="plc_ip" autocomplete="off" required /></label>
<label>Porta do CLP<input name="plc_port" type="number" min="1" max="65535" required /></label>
</div><div class="actions">${button("Cadastrar Dala", "submit-dala")}</div></form></section></div>`;
  }
  const cells = (equipment) => `<div class="dala-grid-row-v2" role="row">
<div class="dala-grid-cell-v2" data-label="Nome" role="cell"><strong>${esc(equipment.name)}</strong></div>
<div class="dala-grid-cell-v2" data-label="Identificador" role="cell"><code>${esc(equipment.equipment_code)}</code></div>
<div class="dala-grid-cell-v2" data-label="IP do CLP" role="cell">${esc(equipment.plc_ip || "—")}</div>
<div class="dala-grid-cell-v2" data-label="Porta do CLP" role="cell">${esc(equipment.plc_port || "—")}</div>
<div class="dala-grid-cell-v2" data-label="Status" role="cell">${dalaStatusCell(equipment)}</div>
<div class="dala-grid-cell-v2" data-label="Ações" role="cell">${dalaReferenceActions(equipment, canManage, canDelete)}</div>
</div>`;
  const content = loading
    ? '<div class="panel page-loading dala-loading" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>Carregando Dalas…</span></div>'
    : loadError
    ? `<div class="panel page-error dala-load-error" role="alert"><h3>Não foi possível carregar as Dalas</h3><p>${esc(loadError)}</p><button class="button secondary" data-action="reload-dalas" type="button">Tentar novamente</button></div>`
    : `<div class="dalas-grid-v2" role="table"><div class="dala-grid-head-v2" role="row">${["Nome", "Identificador", "IP do CLP", "Porta do CLP", "Status", "Ações"].map((label) => `<div role="columnheader">${label}</div>`).join("")}</div>${rows.length ? rows.map(cells).join("") : '<div class="dala-empty-v2" role="row"><div role="cell">Nenhuma Dala cadastrada.</div></div>'}</div>`;
  return `<section class="dalas-screen-v2" aria-labelledby="dalas-title"><div class="dalas-header-v2"><h2 id="dalas-title">Dalas</h2>${canManage ? button("Nova dala", "toggle-dala-form", "primary") : ""}</div>${content}</section>`;
}

// Tela Visualizar Dala: cartões com dados cadastrais e status de comunicação.
