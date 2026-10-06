import { button, esc } from "../../js/funcoes/html.js";
import { numero } from "../../js/funcoes/formato.js?v=202609201000";
import { rotuloComando, rotuloEstado, rotuloStatusComando } from "../../js/funcoes/rotulos.js?v=202609240001";
import {
  pageHeader,
  emergencyPanel,
} from "../../js/funcoes/view.js?v=202609280006";

function equipmentLabel(store) {
  return store.state.equipmentCode && store.state.equipmentCode !== "—"
    ? store.state.equipmentCode
    : store.state.equipments?.[0]?.equipment_code || "Esteira";
}

function compactDeviceStatuses(store) {
  const selectedEquipmentId = Number(store.state.equipmentId) || null;
  const devices = (store.state.monitoring?.dispositivos || []).filter(
    (item) =>
      !selectedEquipmentId || Number(item.equipment_id) === selectedEquipmentId,
  );
  const known = [
    ["SENSOR", "Sensor"],
    ["SCANNER", "Scanner"],
    ["CLP", "CLP"],
    ["CAMERA", "Câmera"],
    ["SERVER", "Servidor"],
  ];
  const isOnline = (value) =>
    ["ONLINE", "LOCAL", "OK"].includes(String(value || "").trim().toUpperCase());
  return `<div class="status status-compact">${known.map(([type, label]) => {
    const value = devices.find((item) => item.device_type === type)?.status ||
      (type === "SERVER" ? "LOCAL" : "OFFLINE");
    const online = isOnline(value);
    return `<span><strong>${label}</strong><b class="status-value status-${online ? "online" : "offline"}" data-live-status="${type}" data-live-status-mode="binary">${online ? "ON" : "OFF"}</b></span>`;
  }).join("")}</div>`;
}

function loadingSelection(store) {
  const activeLoadings = store.state.activeLoadings || [];
  const occupiedEquipmentIds = new Set(
    activeLoadings
      .filter((loading) => loading.equipment_id)
      .map((loading) => Number(loading.equipment_id)),
  );
  const availableEquipments = (store.state.equipments || []).filter(
    (equipment) => !occupiedEquipmentIds.has(Number(equipment.id)),
  );
  const detached = activeLoadings
    .filter((loading) => !loading.equipment_id)
    .map((loading) => {
      const options = availableEquipments
        .map((equipment) => `<option value="${equipment.id}">${esc(equipment.name)} • ${esc(equipment.equipment_code)}</option>`)
        .join("");
      return `<article class="panel detached-loading-card"><span class="kicker">Dala removida</span><h3>${esc(loading.romaneio_number || "Sem romaneio")}</h3><p>Caminhão ${esc(loading.plate || "—")}. O carregamento foi interrompido e aguarda uma nova máquina.</p><form class="reassign-loading-form" data-loading-id="${loading.id}"><label>Selecionar nova Dala<select name="equipment_id" required ${options ? "" : "disabled"}>${options || "<option>Nenhuma Dala disponível</option>"}</select></label><button class="button primary" type="submit" ${options ? "" : "disabled"}>Vincular Dala</button></form></article>`;
    })
    .join("");
  const cards = activeLoadings
    .filter((loading) => loading.equipment_id)
    .map(
      (loading) =>
        `<button class="dala-selection-card" data-action="select-loading" data-id="${loading.id}" type="button"><span class="kicker">${esc(loading.equipment_code || "Dala")}</span><strong>${esc(loading.romaneio_number || "Sem romaneio")}</strong><span>Caminhão ${esc(loading.plate || "—")}</span><b>${esc(rotuloEstado(loading.state))}</b><span class="dala-selection-count">${numero(loading.detected_bags)} sacas detectadas</span><small>Selecionar esta Dala</small></button>`,
    )
    .join("");
  return `${pageHeader("Operação", "Selecionar Dala", "Escolha a Dala que será acompanhada e controlada nesta tela.")}<section class="dala-selection-screen"><div class="dala-selection-heading"><span class="kicker">Operações disponíveis</span><h3>Qual Dala você deseja operar?</h3><p>Cada seleção mantém contagem, comandos e emergência separados.</p></div>${detached ? `<div class="detached-loading-list">${detached}</div>` : ""}<div class="dala-selection-grid">${cards || (detached ? "" : '<p class="empty-cell">Nenhum carregamento disponível.</p>')}</div></section>`;
}
function commandFeedback(command) {
  if (!command) return "";
  const status = String(command.status || "").toUpperCase();
  const tone = ["ERRO", "REJEITADO", "EXPIRADO"].includes(status)
    ? "red"
    : status === "APLICADO"
      ? "blue"
      : "yellow";
  const fallback = {
    PENDENTE: "Comando registrado; aguardando o gateway do PC industrial.",
    PROCESSANDO: "O gateway reservou o comando e está aguardando o resultado do CLP.",
    APLICADO: "O gateway reportou o comando como aplicado. Este retorno não confirma sozinho o estado físico da máquina.",
    REJEITADO: "O gateway rejeitou o comando. Não considere a máquina ligada ou parada com base apenas nesta solicitação.",
    ERRO: "O gateway não conseguiu concluir o comando.",
    EXPIRADO: "O gateway não confirmou o comando dentro do prazo.",
  };
  const detail = command.response_message || fallback[status] || "Aguardando retorno do gateway industrial.";
  return `<aside class="work-command-feedback" role="status" aria-live="polite"><div class="work-command-feedback-heading"><div><span class="kicker">Última comunicação</span><strong>${esc(rotuloComando(command.command))}</strong></div><span class="badge ${tone}">${esc(rotuloStatusComando(status))}</span></div><p>${esc(detail)}</p>${status === "APLICADO" ? '<small>O estado real deve ser confirmado pelos sinais de retorno aprovados do CLP; esse mapa ainda não está disponível.</small>' : ""}</aside>`;
}

function workControls(store) {
  const loadingItems = Array.isArray(store.state.loadingItems)
    ? store.state.loadingItems
    : [];
  const loadedTotal = Number(store.state.loaded) || 0;
  const detectedBags = Number(store.state.detectedBags) || 0;
  const plannedTotal = Number(store.state.planned) || 0;
  const remainingTotal = Math.max(0, plannedTotal - detectedBags);
  const totalPercent = plannedTotal > 0
    ? Math.min(100, Math.round((detectedBags / plannedTotal) * 100))
    : 0;
  const canUnlock = ["ADMIN_EMPRESA", "SUPERVISOR"].includes(
    store.state.userRole,
  );
  const canReverse = ["ADMIN_EMPRESA", "SUPERVISOR", "USUARIO"].includes(
    store.state.userRole,
  );
  const clpDisponivel = store.clpDisponivel();
  const state = store.state.operationalState;
  const pendingStatus = String(store.state.plcCommand?.status || "").toUpperCase();
  const pendingCommand = store.state.plcCommand?.command || "";
  const commandBeingProcessed = pendingStatus === "PROCESSANDO";
  const commandInFlight = store.state.commandInFlight === true;
  const bloqueioComando = (allowedStates, stateMessage, requestedCommand = "") => {
    const samePendingCommand = pendingStatus === "PENDENTE" && pendingCommand === requestedCommand;
    const reason = !store.state.loadingId
      ? "Nenhum carregamento selecionado"
      : !clpDisponivel
        ? store.mensagemClpIndisponivel()
        : commandInFlight
          ? "Enviando o comando ao gateway industrial"
          : commandBeingProcessed
            ? "Aguarde o retorno do comando atual"
            : samePendingCommand
              ? "Este comando já está aguardando o gateway industrial"
              : !allowedStates.includes(state)
                ? stateMessage
                : "";
    return reason ? { disabled: true, "aria-disabled": "true", title: reason } : "";
  };
  const bloqueioEmergencia = store.state.loadingId
    ? ""
    : { disabled: true, "aria-disabled": "true", title: "Nenhum carregamento selecionado" };
  const bloqueioReversao = canReverse
    ? pendingStatus === "PENDENTE"
      ? { disabled: true, "aria-disabled": "true", title: "Aguarde a conclusão do comando atual antes de alterar a reversão" }
      : bloqueioComando(["PAUSADO"], "Pause a máquina antes de pedir a reversão.", "REVERSAO_ATIVAR")
    : { disabled: true, "aria-disabled": "true", title: "Seu perfil não pode alterar a reversão" };
  const loadingPicker = `<button class="button secondary small work-back-button" data-action="goto-manifests" type="button">← Romaneios</button>`;
  const pendingReadings = store.state.pendingReadings || [];
  const manualReadingBlocked = pendingReadings.length > 0;
  const manualReadingUnavailable = state !== "CARREGANDO";
  const manualReadingDisabled = manualReadingBlocked || manualReadingUnavailable;
  const manualOperationReading = store.state.loadingId
    ? `<div class="work-manual-reading" aria-labelledby="work-manual-reading-title"><div class="work-manual-reading-heading"><span class="kicker">Conferência por código</span><h3 id="work-manual-reading-title">Código de barras</h3><p>Aponte o leitor ou digite o código do saco.</p><small>${manualReadingUnavailable ? "Disponível quando a esteira estiver carregando." : "A contagem detectada continua baseada no sensor da esteira."}</small></div><form class="manual-operation-reading-form"><label for="manual-operation-barcode">Código de barras do saco<input id="manual-operation-barcode" name="barcode" type="text" required maxlength="128" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Leia ou digite o código" aria-label="Código de barras do saco"${manualReadingDisabled ? " disabled aria-describedby=manual-reading-blocked" : ""} /></label><button class="button primary" type="submit"${manualReadingDisabled ? " disabled" : ""}>Registrar leitura</button>${manualReadingBlocked ? '<p id="manual-reading-blocked" class="manual-reading-blocked">Há sacos detectados sem código. Use a conferência pendente abaixo para vincular o código ao saco correspondente.</p>' : manualReadingUnavailable ? '<p id="manual-reading-blocked" class="manual-reading-blocked">Inicie o carregamento para registrar uma leitura.</p>' : ""}<p class="form-feedback" data-form-feedback role="status" aria-live="polite" hidden></p></form></div>`
    : "";
  const manualIdentification = pendingReadings.length
    ? `<section class="work-scanner-corrections" aria-labelledby="work-scanner-corrections-title"><div class="work-scanner-corrections-heading"><div><span class="kicker">Conferência pendente</span><h3 id="work-scanner-corrections-title">Leituras sem código</h3></div><p>Passe o leitor de código de barras ou digite o código conferido.</p></div><div class="work-scanner-corrections-list">${pendingReadings.map((reading, index) => `<form class="manual-reading-form" data-reading-id="${reading.id}"><label>Leitura #${reading.id}<input name="barcode" type="text" required maxlength="128" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="none" placeholder="Leia o código do produto" aria-label="Código de barras da leitura ${reading.id}"${index === 0 ? " autofocus" : ""} /></label>${button("Confirmar código", "identify-reading", "secondary")}</form>`).join("")}</div></section>`
    : "";
  const command = store.state.plcCommand;
  const finalized = store.state.operationalState === "FINALIZADO";
  const controls = finalized
    ? ""
    : `<div class="work-controls"><div class="work-routine-controls">${button("Ligar esteira", "run", "primary", bloqueioComando(["PREPARANDO", "PAUSADO"], "Só é possível iniciar em preparação ou com a máquina pausada.", "INICIAR_CARREGAMENTO"))}${button("Desligar esteira", "stop", "ghost", bloqueioComando(["PREPARANDO", "CARREGANDO"], "A máquina não está em um estado que permita solicitar parada.", "PAUSAR_CARREGAMENTO"))}${button("Ligar reversão", "reverse-on", "secondary", bloqueioReversao)}${button("Desligar reversão", "reverse-off", "secondary", bloqueioReversao)}</div><div class="work-emergency-zone">${button("EMERGÊNCIA", "emergency", "danger", bloqueioEmergencia)}</div></div>`;
  const summaryReady = ["FINALIZANDO", "FINALIZADO"].includes(
    store.state.operationalState,
  );
  const summaryAction = summaryReady
    ? `${button("Abrir resumo final", "open-summary", "secondary")}`
    : "";
  const badge =
    store.state.operationalState === "EMERGENCIA"
      ? '<span class="badge red">Emergência solicitada · operação bloqueada</span>'
      : `<span class="badge yellow">${esc(rotuloEstado(store.state.operationalState))}</span>`;
  const activeEmergencyPanel = emergencyPanel({
    canUnlock,
    buttonAttributes: bloqueioComando(["EMERGENCIA"], "Aguarde a confirmação do CLP antes de solicitar liberação."),
    commandStatus: store.state.plcCommand,
    compact: true,
  });
  const itemProgress = `<section class="panel work-items-panel"><div class="panel-heading"><div><h3>Itens do romaneio</h3></div><div class="work-items-summary"><small>${numero(loadingItems.length)} itens · <strong data-live="loaded">${numero(loadedTotal)}</strong> leituras válidas</small></div></div><div class="work-item-progress-list">${loadingItems.length ? loadingItems.map((item) => {
    const loaded = Number(item.loaded_quantity) || 0;
    const planned = Number(item.planned_quantity) || 0;
    const remaining = Math.max(0, Number(item.remaining_quantity) || planned - loaded);
    const percent = planned > 0 ? Math.min(100, Math.round((loaded / planned) * 100)) : 0;
    const status = loaded >= planned ? ["Concluído", "green"] : loaded > 0 ? ["Em andamento", "blue"] : ["Pendente", "yellow"];
    return `<article class="work-item-progress-card"><div class="work-item-progress-heading"><div class="work-item-identity"><strong>${esc(item.name || "Produto")}</strong><code>${esc(item.code || "—")}</code></div><span class="badge ${status[1]}">${status[0]}</span></div><div class="work-item-progress-values"><strong>${numero(loaded)} <span>/ ${numero(planned)}</span></strong><span>${percent}%</span></div><div class="work-item-progress-track" role="progressbar" aria-label="Leituras válidas de ${esc(item.name || "produto")}" aria-valuemin="0" aria-valuemax="${planned}" aria-valuenow="${Math.min(loaded, planned)}"><i style="width:${percent}%"></i></div><div class="work-item-progress-foot"><span>Identificadas</span><span>Faltam validar <strong>${numero(remaining)}</strong></span></div></article>`;
  }).join("") : '<p class="empty-cell">Nenhum item detalhado para este carregamento.</p>'}</div></section>`;
  const workTitle = store.state.romaneio && store.state.romaneio !== "—"
    ? `Romaneio #${store.state.romaneio}`
    : "Operação";
  const nearEndThreshold = plannedTotal > 0 ? Math.max(1, Math.ceil(plannedTotal * 0.1)) : 0;
  const nearEnd = plannedTotal > 0 && detectedBags > 0 && remainingTotal > 0 && remainingTotal <= nearEndThreshold;
  const complete = plannedTotal > 0 && remainingTotal === 0;
  const endNotice = complete
    ? "Quantidade programada atingida. Confira as leituras finais."
    : nearEnd
      ? "Atenção: o romaneio está próximo do fim."
      : "";
  const endNoticeTone = complete ? "complete" : "near-end";
  const totalSummary = `<section class="work-live-summary" aria-label="Contagem e progresso do carregamento"><div class="work-live-summary-heading"><strong>Sacas detectadas</strong><span><b data-live="detected">${numero(detectedBags)}</b> / <b data-live="planned">${numero(plannedTotal)}</b> · <span data-live="progress-percent">${totalPercent}%</span></span></div><div class="progress work-live-progress"><i data-live="progress-bar" style="width:${totalPercent}%"></i></div><div class="work-live-summary-foot"><span>Faltam <b data-live="remaining">${numero(remainingTotal)}</b> leituras válidas</span><span class="work-live-summary-divider" aria-hidden="true">·</span><span><b data-live="valid-readings">${numero(loadedTotal)}</b> válidas</span></div><p class="work-completion-notice ${endNoticeTone}" data-live="end-notice"${endNotice ? "" : " hidden"}>${endNotice}</p>${manualOperationReading}</section>`;
  const machinePanel = `<section class="panel work-machine-panel"><div class="panel-heading"><div><span class="kicker">Comandos da máquina</span><h3>Operar Dala</h3></div></div>${store.state.emergency ? activeEmergencyPanel : `<div class="work-machine-controls">${controls}</div>${commandFeedback(command)}`}</section>`;
  const statusColumn = `<section class="work-status-column">${totalSummary}${manualIdentification}${itemProgress}</section>`;
  const workHeader = `<header class="work-screen-header">${loadingPicker}<div class="work-screen-heading"><h2>${esc(workTitle)}</h2><p>Dala ${esc(equipmentLabel(store))} · Caminhão ${esc(store.state.truck || "—")} <span class="work-header-state">${badge}</span></p></div><div class="work-screen-actions"><section class="work-header-statuses" aria-label="Status dos dispositivos"><div class="work-device-status-heading"><span class="kicker">Status da máquina</span><span>· Atualizado em tempo real</span></div>${compactDeviceStatuses(store)}</section>${summaryAction}</div></header>`;
  return `<div class="work-operation-screen">${workHeader}<div class="work-operation-layout">${statusColumn}${machinePanel}</div></div>`;
}
export function work(store) {
  if (
    !store.state.selectedLoadingId &&
    (store.state.activeLoadings || []).length
  )
    return loadingSelection(store);
  return workControls(store);
}
