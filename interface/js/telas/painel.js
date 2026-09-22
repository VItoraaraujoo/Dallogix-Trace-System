import { button, esc } from "../funcoes/html.js";
import { numero } from "../funcoes/formato.js?v=202609201000";
import { rotuloEstado } from "../funcoes/rotulos.js";
import { deviceBadge, operationalBadge, pageHeader } from "../funcoes/view.js?v=202609220100";

function dalaAlbumCard(equipment, machines, role) {
  const machine =
    machines.find((item) => Number(item.id) === Number(equipment.id)) || {};
  const status = machine.clp_status || "DESCONHECIDO";
  const loadingId = machine.carregamento_id || "";
  const state = String(machine.carregamento_state || "AGUARDANDO").toUpperCase();
  const planned = Number(machine.planned_quantity || 0);
  const loaded = Number(machine.valid_readings || 0);
  const percentage =
    planned > 0 ? Math.min(100, Math.round((loaded / planned) * 100)) : 0;
  return `<article class="dala-album-card">
    <header>
      <div>
        <span class="album-label">Dala</span>
        <h3>${esc(equipment.name)}</h3>
        <code>${esc(equipment.equipment_code)}</code>
      </div>
      ${deviceBadge(status)}
    </header>
    <div class="dala-album-info dala-romaneio-info">
      <div><small>Romaneio</small><strong>${machine.romaneio_number ? `#${esc(machine.romaneio_number)}` : "Sem romaneio"}</strong></div>
      <div><small>Caminhão</small><strong>${esc(machine.plate || "—")}</strong></div>
      <div><small>Estado</small><strong>${esc(rotuloEstado(state))}</strong></div>
      <div><small>Estado físico</small><strong>${operationalBadge(machine.operational_status)}</strong></div>
      <div><small>Carregado</small><strong>${numero(loaded)} / ${numero(planned)}</strong></div>
    </div>
    <div class="album-progress"><div class="progress"><i style="width:${percentage}%"></i></div><small>${percentage}% do romaneio</small></div>
    <footer>
      <div class="dashboard-card-links"><button class="button secondary small" data-action="view-dala" data-id="${equipment.id}" type="button">Visualizar Dala e estatísticas</button>${machine.romaneio_id ? `<button class="button secondary small" data-action="view-manifest" data-id="${machine.romaneio_id}" type="button">Romaneio</button>` : ""}</div>
    </footer>
  </article>`;
}

function dalaSkeletonCard() {
  return `<article class="dala-album-card dala-album-card-skeleton" aria-hidden="true">
    <header><div><span class="skeleton-line skeleton-label"></span><span class="skeleton-line skeleton-title"></span><span class="skeleton-line skeleton-code"></span></div><span class="skeleton-badge"></span></header>
    <div class="dala-album-info"><div><span class="skeleton-line"></span><span class="skeleton-line skeleton-value"></span></div><div><span class="skeleton-line"></span><span class="skeleton-line skeleton-value"></span></div><div><span class="skeleton-line"></span><span class="skeleton-line skeleton-value"></span></div><div><span class="skeleton-line"></span><span class="skeleton-line skeleton-value"></span></div></div>
    <div class="skeleton-progress"></div><footer><span class="skeleton-line skeleton-footer"></span><span class="skeleton-button"></span></footer>
  </article>`;
}

function dashboardEquipmentPriority(equipment, machines) {
  const machine = machines.find((item) => Number(item.id) === Number(equipment.id)) || {};
  const status = String(machine.clp_status || "").toUpperCase();
  const state = String(machine.carregamento_state || "").toUpperCase();
  const offline = status && status !== "ONLINE";
  const emergency = state.includes("EMERGEN") || machine.emergency === true;
  const active = Boolean(machine.carregamento_id);
  return (offline ? 100 : 0) + (emergency ? 50 : 0) + (active ? 10 : 0);
}

// Dashboard no padrão da referência TracePlatform: somente informações das Dalas.
export function dashboard(store) {
  const equipments = store.state.equipments || [];
  const machines = store.state.monitoring?.maquinas || [];
  const sync = store.state.syncStatus || {};
  const centralSync = sync.central_sync || {};
  const pcStatus = String(centralSync.pc_status || (centralSync.pc_online ? "ONLINE" : "DESCONHECIDO")).toUpperCase();
  const pcOnline = pcStatus === "ONLINE";
  const pcLabel = pcOnline
    ? "PC industrial online"
    : pcStatus === "ERRO"
      ? "PC industrial com erro"
      : pcStatus === "OFFLINE"
        ? "PC industrial sem comunicação"
        : "PC industrial sem confirmação";
  const dalaStatuses = Array.isArray(store.state.dalaStatuses) ? store.state.dalaStatuses : [];
  const onlineDalas = dalaStatuses.filter((dala) => String(dala.status || "").toUpperCase() === "ONLINE").length;
  const dalaLabel = equipments.length
    ? `${onlineDalas}/${equipments.length} Dala(s) online`
    : "Nenhuma Dala cadastrada";
  const connectivityPanel = `<section class="panel dashboard-connectivity" aria-label="Conectividade da instalação"><div class="panel-heading"><div><span class="kicker">Conectividade da instalação</span><h3>PC industrial e Dalas</h3></div><span class="badge ${pcOnline ? "green" : pcStatus === "ERRO" ? "red" : "yellow"}">${pcLabel}</span></div><div class="sync-status-row"><span class="status-dot ${pcOnline ? "online" : "offline"}"></span><strong>${esc(pcLabel)}</strong></div><div class="sync-status-row"><span class="status-dot ${onlineDalas === equipments.length && equipments.length > 0 ? "online" : equipments.length > 0 ? "offline" : ""}"></span><strong>Dalas</strong><span>${esc(dalaLabel)}</span></div></section><br>`;
  const canManageDalas = store.state.userRole === "ADMIN_EMPRESA";
  const loading = !store.state.equipmentsLoaded;
  const sortedEquipments = [...equipments].sort(
    (left, right) =>
      dashboardEquipmentPriority(right, machines) -
      dashboardEquipmentPriority(left, machines),
  );
  const content = loading
    ? `${dalaSkeletonCard()}${dalaSkeletonCard()}${dalaSkeletonCard()}`
    : store.state.equipmentsError
      ? `<div class="panel page-error"><p>${esc(store.state.equipmentsError)}</p><button class="button secondary" data-action="reload-page" type="button">Tentar novamente</button></div>`
      : sortedEquipments.length
        ? sortedEquipments
            .map((equipment) => dalaAlbumCard(equipment, machines, store.state.userRole))
            .join("")
        : '<div class="panel placeholder-panel"><p>Nenhuma Dala cadastrada para esta empresa.</p></div>';
  return `${pageHeader("Esteiras e romaneios", "Operação por Dala", "Estado e progresso de cada operação em andamento.", canManageDalas ? button("Gerenciar Dalas", "goto-dalas", "secondary") : "")}
  ${connectivityPanel}
  <section class="dashboard-dalas">
    <div class="dala-album-grid ${loading ? "is-loading" : ""}">${content}</div>
  </section>`;
}
