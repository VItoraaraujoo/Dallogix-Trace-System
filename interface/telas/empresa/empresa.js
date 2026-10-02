import { button, esc } from "../../js/funcoes/html.js";
import { dataHora } from "../../js/funcoes/formato.js?v=202609170930";
import { pageHeader, machineGrid, deviceBadge } from "../../js/funcoes/view.js?v=202609280006";

export function company(store) {
  const detail = store.state.companyDetail;
  if (!detail) {
    return `<div class="title-row has-back"><button class="button secondary page-back" data-action="back-companies" type="button">← Voltar</button><div><span class="kicker">Dallogix / gerenciamento</span><h2>Empresa</h2><p>Selecione uma empresa na visão geral.</p></div></div><section class="panel"><p class="empty-cell">Nenhuma empresa selecionada.</p></section>`;
  }
  const machines = detail.maquinas || [];
  const total = machines.length;
  const online = machines.filter(
    (machine) => String(machine.clp_status || "").toUpperCase() === "ONLINE",
  ).length;
  const notOnline = total - online;
  const occurrences = detail.ocorrencias_recentes || [];
  const romaneios = detail.romaneios || {};
  const openRomaneios =
    (romaneios.AGUARDANDO || 0) + (romaneios.EM_ANDAMENTO || 0);
  const installations = store.state.industrialInstallations || [];
  const equipmentOptions = store.state.industrialEquipmentOptions || [];
  const generatedCode = store.state.industrialInstallationActivation;
  const licenseStatus = String(detail.license_status || "SEM_LICENCA");
  const licenseActive = licenseStatus === "ATIVA";
  const industrialPcRows = installations.map((installation) => {
    const code = generatedCode?.id === installation.id
      ? generatedCode.activation_code
      : installation.activation_code;
    const isActivated = Boolean(installation.activated || installation.activated_at);
    const status = String(installation.status || "DESCONHECIDO");
    const options = equipmentOptions.filter((equipment) =>
      !equipment.industrial_pc_id || Number(equipment.industrial_pc_id) === Number(installation.id),
    );
    const equipmentSelect = (!isActivated || !installation.equipment_id) && options.length
      ? `<form class="industrial-pc-link-form" data-installation-id="${installation.id}"><label>Dala vinculada<select name="equipment_id" required><option value="">Selecione uma Dala</option>${options.map((equipment) => `<option value="${equipment.id}" ${Number(equipment.id) === Number(installation.equipment_id) ? "selected" : ""}>${esc(equipment.name)} · ${esc(equipment.equipment_code)}</option>`).join("")}</select></label><button class="button secondary small" data-action="link-industrial-pc-dala" type="button">Vincular</button></form>`
      : (!isActivated || !installation.equipment_id) && !installation.equipment_id
      ? `<small>A Dala será vinculada quando este PC sincronizar o primeiro cadastro local.</small>`
      : `<span>${installation.equipment_name ? `${esc(installation.equipment_name)} · ${esc(installation.equipment_code)}` : "Dala pendente"}</span>`;
    const activation = isActivated
      ? `<strong>Ativado${installation.last_seen_at ? ` · sinal ${esc(dataHora(installation.last_seen_at))}` : ""}</strong><button class="button secondary small" data-action="revoke-industrial-pc-access" data-id="${installation.id}" data-name="${esc(installation.name)}" type="button">Revogar acesso</button>`
      : code
      ? `<strong class="company-activation-code">${esc(code)}</strong><button class="button secondary small" data-action="copy-industrial-pc-code" data-code="${esc(code)}" type="button">Copiar código</button>`
      : `<button class="button primary small" data-action="generate-industrial-pc-code" data-id="${installation.id}" type="button" ${licenseActive ? "" : "disabled"}>Gerar código</button>`;
    return `<article class="industrial-pc-row"><div><strong>${esc(installation.name)}</strong><small>PC industrial ${installation.id} · ${esc(status)}</small></div><div>${equipmentSelect}</div><div class="industrial-pc-activation">${activation}</div></article>`;
  }).join("");
  const installationPanel = `<section class="panel industrial-pcs-panel"><div class="panel-heading"><div><span class="kicker">Acesso individual por PC</span><h3>PCs industriais e Dalas</h3><p>Cada PC recebe um código próprio e sincroniza somente a Dala vinculada a ele. O primeiro cadastro de Dala no PC pode completar o vínculo automaticamente.</p></div></div><form id="industrial-pc-create-form" data-company-id="${detail.id}" class="industrial-pc-create-form"><label>Nome do PC industrial<input name="name" maxlength="160" required placeholder="Ex.: Esteira 1 · Unidade Campinas" /></label><button class="button primary" type="submit">Cadastrar PC industrial</button><p class="form-feedback" data-form-feedback role="status" aria-live="polite" hidden></p></form><div class="industrial-pc-list">${industrialPcRows || '<p class="empty-cell">Nenhum PC industrial cadastrado. Cadastre um PC e gere o código para iniciar a ativação.</p>'}</div>${!licenseActive ? '<small>Ative a licença da empresa para gerar códigos de ativação.</small>' : ""}</section><br>`;
  const renamePanel = `<section class="panel"><form id="company-rename-form" data-company-id="${detail.id}"><div class="panel-heading"><div><span class="kicker">Cadastro da empresa</span><h3>Nome da empresa</h3><p>O domínio dos logins permanece o mesmo para não interromper os acessos existentes.</p></div><button class="button primary" type="submit">Salvar nome</button></div><label>Nome comercial<input name="name" maxlength="160" value="${esc(detail.name)}" required /></label><p class="form-feedback" data-form-feedback role="status" aria-live="polite" hidden></p></form></section><br>`;
  return `<div class="title-row with-actions has-back"><button class="button secondary page-back" data-action="back-companies" type="button">← Voltar</button><div><span class="kicker">Dallogix / gerenciamento</span><h2>${esc(detail.name)}</h2></div><div class="actions">${button("Logins", "open-users", "secondary", `data-company-id="${detail.id}"`)}</div></div>
    ${renamePanel}${installationPanel}
    <div class="grid four dashboard-metrics">
      <div class="panel metric"><small>Máquinas</small><strong>${total}</strong></div>
      <div class="panel metric"><small>Online</small><strong class="metric-green">${online}</strong></div>
      <div class="panel metric"><small>Não online</small><strong class="${notOnline > 0 ? "metric-red" : ""}">${notOnline}</strong></div>
      <div class="panel metric"><small>Romaneios abertos</small><strong>${openRomaneios}</strong></div>
    </div><br>
    ${machineGrid(machines, "Nenhuma máquina cadastrada para esta empresa.")}<br>
    <section class="panel"><h3>Periféricos reportados</h3>${machines.length ? `<div class="table-wrap"><table><thead><tr><th>Máquina</th><th>Identificador</th><th>CLP</th><th>Último sinal</th></tr></thead><tbody>${machines.map((machine) => `<tr><td><strong>${esc(machine.name)}</strong></td><td>${esc(machine.equipment_code)}</td><td>${deviceBadge(machine.clp_status)}</td><td>${esc(dataHora(machine.last_seen_at))}</td></tr>`).join("")}</tbody></table></div>` : '<p class="empty-cell">Sem dispositivos registrados.</p>'}</section><br>
    <section class="panel"><h3>Ocorrências recentes</h3><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Quantidade</th><th>Descrição</th><th>Data</th></tr></thead><tbody>${occurrences.length ? occurrences.map((occurrence) => `<tr><td><strong>${esc(occurrence.type)}</strong></td><td>${Number(occurrence.quantity)}</td><td>${occurrence.description ? esc(occurrence.description) : "—"}</td><td>${esc(dataHora(occurrence.created_at))}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-cell">Nenhuma ocorrência registrada.</td></tr>'}</tbody></table></div></section>`;
}
