import { button, esc } from "./html.js";

export function pageHeader(kicker, title, description, action = "") {
  return `<div class="title-row"><div><span class="kicker">${esc(kicker)}</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div>${action}</div>`;
}
export function statuses(store = null) {
  const selectedEquipmentId = Number(store?.state?.equipmentId) || null;
  const devices = (store?.state?.monitoring?.dispositivos || []).filter(
    (item) =>
      !selectedEquipmentId || Number(item.equipment_id) === selectedEquipmentId,
  );
  const known = ["SENSOR", "SCANNER", "CLP", "CAMERA", "SERVER"];
  const labels = {
    SENSOR: "Sensor",
    SCANNER: "Scanner",
    CLP: "CLP",
    CAMERA: "Câmera",
    SERVER: "Servidor",
  };
  const status = (type) =>
    devices.find((item) => item.device_type === type)?.status ||
    (type === "SERVER" ? "LOCAL" : "NÃO REGISTRADO");
  const tone = (value) => (["ONLINE", "LOCAL"].includes(value) ? "OK" : value);
  return `<div class="status">${known.map((type) => `<span>● ${labels[type]} <b>${esc(tone(status(type)))}</b></span>`).join("")}</div>`;
}
export function progress(store) {
  const loaded = Number(store.state.loaded) || 0;
  const planned = Number(store.state.planned) || 0;
  const pct =
    planned > 0 ? Math.min(100, Math.round((loaded / planned) * 100)) : 0;
  return `<div class="progress"><i style="width:${pct}%"></i></div><div class="progress-label"><span>${pct}% concluído</span><span>${loaded.toLocaleString("pt-BR")} / ${planned.toLocaleString("pt-BR")} sacas</span></div>`;
}
export function badge(status) {
  const labels = {
    IMPORTADO: "Importado",
    AGUARDANDO: "Aguardando",
    EM_ANDAMENTO: "Em andamento",
    FINALIZADO: "Finalizado",
    CANCELADO: "Cancelado",
  };
  const label = labels[status] || status;
  const tone = ["FINALIZADO", "Finalizado"].includes(status)
    ? "green"
    : ["CANCELADO", "Cancelado"].includes(status)
      ? "red"
      : "yellow";
  return `<span class="badge ${tone}">${label}</span>`;
}

// Badge de status no padrão da referência TracePlatform.
export function manifestStatusBadge(row) {
  if (row.status === "EM_ANDAMENTO") {
    if (String(row.active_state || "").toUpperCase() === "PAUSADO")
      return '<span class="badge info">Aguardando continuação</span>';
    return `<span class="badge blue">Em andamento${row.active_equipment ? " - " + esc(row.active_equipment) : ""}</span>`;
  }
  if (row.status === "FINALIZADO") {
    return Number(row.has_divergence)
      ? '<span class="badge orange">Finalizado c/ divergência</span>'
      : '<span class="badge green">Finalizado</span>';
  }
  if (row.status === "CANCELADO")
    return '<span class="badge red">Cancelado</span>';
  return badge(row.status);
}

const formatDate = (value) =>
  value ? String(value).split("-").reverse().join("/") : "—";

export function manifestsTable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const body = list.length
    ? list
        .map((r) => {
          const operating = r.status === "EM_ANDAMENTO";
          const operation = operating
            ? `<button class="button primary small" data-action="resume-loading" data-id="${r.id}" data-loading-id="${r.active_loading_id || ""}" type="button">${r.active_state === "PAUSADO" ? "Continuar" : "Retomar"}</button>`
            : "";
          return `<tr>
          <td>${formatDate(r.scheduled_date)}</td>
          <td><strong>${esc(r.number)}</strong></td>
          <td>${esc(r.expedidor || "—")}</td>
          <td>${manifestStatusBadge(r)}</td>
          <td>${button("Visualizar", "view-manifest", "secondary").replace('data-action="view-manifest"', `data-action="view-manifest" data-id="${r.id}"`)}</td>
          <td>${operation}</td>
        </tr>`;
        })
        .join("")
    : '<tr><td colspan="6">Nenhum romaneio encontrado para os filtros informados.</td></tr>';
  return `<div class="panel table-wrap"><table><thead><tr><th>Data do carregamento</th><th>Código do romaneio</th><th>Expedidor</th><th>Status</th><th>Ações</th><th>Operação</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

const loadingStateLabels = {
  AGUARDANDO: "Aguardando",
  PREPARANDO: "Preparando",
  CARREGANDO: "Carregando",
  PAUSADO: "Pausado",
  FINALIZANDO: "Finalizando",
  FINALIZADO: "Finalizado",
  EMERGENCIA: "Emergência",
  ERRO: "Erro",
};

export function deviceBadge(value) {
  const normalized = String(value || "DESCONHECIDO").toUpperCase();
  const labels = {
    ONLINE: "Online",
    OFFLINE: "Offline",
    ERRO: "Erro",
    DESCONHECIDO: "Sem sinal",
    LOCAL: "Local",
  };
  const tone =
    normalized === "ONLINE" || normalized === "LOCAL"
      ? "green"
      : normalized === "ERRO"
        ? "red"
        : "yellow";
  return `<span class="badge ${tone}">${esc(labels[normalized] || normalized)}</span>`;
}

function machineCard(machine) {
  const loaded = Number(machine.valid_readings || 0);
  const planned = Number(machine.planned_quantity || 0);
  const pct =
    planned > 0 ? Math.min(100, Math.round((loaded / planned) * 100)) : 0;
  const state =
    loadingStateLabels[machine.carregamento_state] ||
    machine.carregamento_state ||
    "Ociosa";
  return `<article class="machine-card ${String(machine.clp_status || "").toUpperCase() === "ONLINE" ? "" : "is-offline"}">
    <header><div><strong>${esc(machine.name)}</strong><small>${esc(machine.equipment_code)}</small></div>${deviceBadge(machine.clp_status)}</header>
    <dl>
      <div><dt>Romaneio</dt><dd>${machine.romaneio_number ? "#" + esc(machine.romaneio_number) : "—"}</dd></div>
      <div><dt>Caminhão</dt><dd>${machine.plate ? esc(machine.plate) : "—"}</dd></div>
      <div><dt>Estado</dt><dd>${esc(state)}</dd></div>
      <div><dt>Último sinal</dt><dd>${machine.last_seen_at ? esc(machine.last_seen_at) : "—"}</dd></div>
    </dl>
    <div class="progress"><i style="width:${pct}%"></i></div>
    <div class="progress-label"><span>${pct}% concluído</span><span>${loaded.toLocaleString("pt-BR")} / ${planned.toLocaleString("pt-BR")} sacas</span></div>
  </article>`;
}

export function machineGrid(
  machines,
  emptyMessage = "Nenhuma máquina cadastrada.",
) {
  const list = Array.isArray(machines) ? machines : [];
  return `<div class="card-grid machine-grid">${list.length ? list.map(machineCard).join("") : `<p class="empty-cell">${emptyMessage}</p>`}</div>`;
}

export function companyCard(company) {
  const total = Number(company.total_machines || 0);
  const online = Number(company.machines_online || 0);
  const offline = Number(
    company.machines_offline ?? Math.max(0, total - online),
  );
  const users = Number(company.total_users || 0);
  const activeUsers = Number(company.active_users || 0);
  const occurrences = Number(company.ocorrencias_24h || 0);
  const connection =
    online > 0
      ? '<span class="badge green">Online</span>'
      : '<span class="badge red">Sem conexão</span>';
  const licenseStatus = String(company.license_status || "SEM_LICENCA");
  const licenseLabel = {
    ATIVA: "Licença ativa",
    INADIMPLENTE: "Inadimplente",
    BLOQUEADA: "Bloqueada",
    CANCELADA: "Cancelada",
    SEM_LICENCA: "Sem licença",
  }[licenseStatus] || licenseStatus;
  const licenseTone = licenseStatus === "ATIVA" ? "green" : "red";
  const licenseAction = licenseStatus === "ATIVA" ? "Bloquear licença" : "Ativar licença";
  return `<article class="company-card">
    <header><div><strong>${esc(company.name)}</strong><small>${total} máquina(s) • último sinal ${company.last_signal_at ? esc(company.last_signal_at) : "—"}</small></div><div>${connection}<span class="badge ${licenseTone}">${esc(licenseLabel)}</span></div></header>
    <div class="company-card-metrics">
      <div><b>${total}</b><small>Máquinas</small></div>
      <div><b class="metric-green">${online}</b><small>Online</small></div>
      <div><b>${activeUsers}/${users}</b><small>Acessos ativos</small></div>
    </div>
    <footer><span class="kicker">${offline > 0 ? `${offline} máquina(s) sem sinal · ` : ""}${occurrences} ocorrência(s) em 24h${company.license_due_at ? ` · vence ${esc(company.license_due_at)}` : ""}</span><div class="actions"><button class="button secondary" data-action="open-company" data-id="${company.id}" type="button">Gerenciar</button><button class="button ${licenseStatus === "ATIVA" ? "danger" : "primary"} small" data-action="toggle-license" data-id="${company.id}" data-status="${esc(licenseStatus)}" data-due="${esc(company.license_due_at || "")}" type="button">${licenseAction}</button></div></footer>
  </article>`;
}

export function companyGrid(
  companies,
  emptyMessage = "Nenhuma empresa cadastrada.",
) {
  const list = Array.isArray(companies) ? companies : [];
  return `<div class="card-grid company-grid">${list.length ? list.map(companyCard).join("") : `<p class="empty-cell">${emptyMessage}</p>`}</div>`;
}
