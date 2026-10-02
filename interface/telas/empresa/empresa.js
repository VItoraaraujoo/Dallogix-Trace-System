import { button, esc } from "../../js/funcoes/html.js";
import { dataHora } from "../../js/funcoes/formato.js?v=202609170930";
import { machineGrid, deviceBadge } from "../../js/funcoes/view.js?v=202609280006";

export function company(store) {
  const detail = store.state.companyDetail;
  if (!detail) {
    return `<div class="title-row company-detail-header"><div class="company-detail-heading"><span class="kicker">Dallogix / gerenciamento</span><button class="button secondary page-back" data-action="back-companies" type="button">← Voltar</button></div></div><section class="panel"><p class="empty-cell">Nenhuma empresa selecionada.</p></section>`;
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
  const activeInstallations = installations.filter((installation) => !installation.archived);
  const archivedInstallations = installations.filter((installation) => installation.archived);
  const renderInstallation = (installation, archived = false) => {
    const id = Number(installation.id);
    const name = esc(installation.name);
    const dalaName = esc(installation.equipment_name || "Dala vinculada");
    const isActivated = Boolean(installation.activated || installation.activated_at);
    const isBlocked = Boolean(installation.access_blocked);
    const statusKey = String(installation.status || "DESCONHECIDO").toUpperCase();
    const status = archived ? "Arquivado" : ({
      ONLINE: "Online",
      OFFLINE: "Offline",
      ERRO: "Com erro",
      DESCONHECIDO: "Sem sinal",
    }[statusKey] || "Sem sinal");
    const stateClass = archived ? "archived" : isBlocked ? "blocked" : ({
      ONLINE: "online",
      OFFLINE: "offline",
      ERRO: "error",
      DESCONHECIDO: "unknown",
    }[statusKey] || "unknown");
    const code = !archived && !isBlocked
      ? (generatedCode?.id === id ? generatedCode.activation_code : installation.activation_code)
      : null;
    const options = equipmentOptions.filter((equipment) =>
      !equipment.industrial_pc_id || Number(equipment.industrial_pc_id) === id,
    );
    const canLinkDala = !archived && !isBlocked && (!isActivated || !installation.equipment_id) && options.length > 0;
    const dalaControl = canLinkDala
      ? '<form class="industrial-pc-link-form" data-installation-id="' + id + '"><label>Dala deste PC<select name="equipment_id" required><option value="">Selecione uma Dala</option>' +
        options.map((equipment) => '<option value="' + Number(equipment.id) + '"' +
          (Number(equipment.id) === Number(installation.equipment_id) ? ' selected' : '') + '>' +
          esc(equipment.name) + ' · ' + esc(equipment.equipment_code) + '</option>').join("") +
        '</select></label><button class="button secondary small" data-action="link-industrial-pc-dala" type="button">Vincular Dala</button></form>'
      : '<div class="industrial-pc-dala"><small>Dala vinculada</small><strong>' + dalaName +
        (installation.equipment_code ? ' · ' + esc(installation.equipment_code) : '') + '</strong></div>';
    const activationControl = archived
      ? '<p class="industrial-pc-note">O acesso e o código foram revogados ao arquivar. Restaure e gere um novo código para reativar este PC.</p>'
      : isBlocked
      ? '<p class="industrial-pc-note">O acesso remoto desta Dala está bloqueado. A operação local continua funcionando.</p>'
      : isActivated
      ? '<p class="industrial-pc-note"><strong>Ativado</strong>' +
        (installation.last_seen_at ? ' · último sinal ' + esc(dataHora(installation.last_seen_at)) : '') + '</p>'
      : code
      ? '<details class="industrial-pc-code"><summary>Ver código de ativação</summary><div><code>' + esc(code) +
        '</code><button class="button secondary small" data-action="copy-industrial-pc-code" data-code="' + esc(code) + '" type="button">Copiar código</button></div></details><button class="button secondary small" data-action="revoke-industrial-pc-access" data-id="' + id + '" type="button">Cancelar código</button>'
      : '<p class="industrial-pc-note">Aguardando código de ativação.</p><button class="button primary small" data-action="generate-industrial-pc-code" data-id="' + id + '" type="button" ' +
        (licenseActive ? '' : 'disabled') + '>Gerar código</button>';
    const accessActions = archived
      ? '<div class="actions industrial-pc-actions"><button class="button secondary small" data-action="restore-industrial-pc" data-id="' + id + '" type="button">Restaurar PC</button><button class="button danger small" data-action="delete-industrial-pc" data-id="' + id + '" data-name="' + name + '" type="button">Excluir definitivamente</button></div>'
      : '<div class="industrial-pc-access"><strong>' + (isBlocked ? 'Acesso bloqueado' : isActivated ? 'Acesso liberado' : 'Acesso ainda não ativado') +
        '</strong><button class="button ' + (isBlocked ? 'primary' : 'secondary') + ' small" data-action="toggle-industrial-pc-access" data-id="' + id +
        '" data-name="' + name + '" data-dala-name="' + dalaName + '" data-blocked="' + (!isBlocked) + '" type="button">' +
        (isBlocked ? 'Liberar acesso' : 'Bloquear acesso') + '</button></div><div class="actions industrial-pc-actions"><button class="button secondary small" data-action="archive-industrial-pc" data-id="' + id + '" data-name="' + name + '" type="button">Arquivar PC</button></div>';
    return '<article class="industrial-pc-row is-' + stateClass + (archived ? ' is-archived' : '') + '"><div class="industrial-pc-summary"><div><strong>' + name +
      '</strong><small>PC industrial ' + id + ' · ' + esc(status) + '</small></div>' + dalaControl + '</div><div class="industrial-pc-activation">' +
      activationControl + '</div><div class="industrial-pc-controls">' + accessActions + '</div></article>';
  };
  const createPcPanel = '<section class="panel industrial-pc-create-panel"><div class="panel-heading"><div><h3>Cadastrar PC industrial</h3></div></div><form id="industrial-pc-create-form" data-company-id="' + Number(detail.id) +
    '" class="industrial-pc-create-form"><label>Nome do PC industrial<input name="name" maxlength="160" required placeholder="Ex.: Esteira 1 · Unidade Campinas" /></label><button class="button primary" type="submit">Cadastrar PC industrial</button><p class="form-feedback" data-form-feedback role="status" aria-live="polite" hidden></p></form></section><br>';
  const managePcPanel = '<section class="panel industrial-pc-management-panel"><div class="panel-heading"><div><span class="kicker">Acesso individual por PC</span><h3>Gerenciar PCs industriais</h3><p>Bloquear pausa a sincronização desta Dala. A operação local continua; os dados sincronizam quando o acesso for liberado.</p></div></div><div class="industrial-pc-list">' +
    (activeInstallations.length ? activeInstallations.map((installation) => renderInstallation(installation)).join("") : '<p class="empty-cell">Nenhum PC industrial cadastrado. Use o formulário acima para criar o primeiro.</p>') +
    '</div>' + (archivedInstallations.length ? '<details class="industrial-pc-archived"><summary>PCs arquivados (' + archivedInstallations.length + ')</summary><div class="industrial-pc-list">' +
      archivedInstallations.map((installation) => renderInstallation(installation, true)).join("") + '</div></details>' : '') +
    (!licenseActive ? '<small>Ative a licença da empresa para gerar códigos de ativação.</small>' : '') + '</section><br>';
  const renamePanel = `<section class="panel"><form id="company-rename-form" data-company-id="${detail.id}"><div class="panel-heading"><div><span class="kicker">Cadastro da empresa</span><h3>Nome da empresa</h3><p>O domínio dos logins permanece o mesmo para não interromper os acessos existentes.</p></div><button class="button primary" type="submit">Salvar nome</button></div><label>Nome comercial<input name="name" maxlength="160" value="${esc(detail.name)}" required /></label><p class="form-feedback" data-form-feedback role="status" aria-live="polite" hidden></p></form></section><br>`;
  return `<div class="title-row with-actions company-detail-header"><div class="company-detail-heading"><span class="kicker">Dallogix / gerenciamento</span><button class="button secondary page-back" data-action="back-companies" type="button">← Voltar</button></div><div class="actions">${button("Logins", "open-users", "secondary", `data-company-id="${detail.id}"`)}</div></div>
    ${renamePanel}${createPcPanel}${managePcPanel}
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
