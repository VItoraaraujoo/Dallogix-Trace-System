import { dataHora, numero } from "../../js/funcoes/formato.js?v=202609170930";
import { button, esc } from "../../js/funcoes/html.js";
import { rotuloComando, rotuloEstado, rotuloEvento, rotuloStatusComando } from "../../js/funcoes/rotulos.js";
import { pageHeader, physicalStateBadge } from "../../js/funcoes/view.js?v=202609280006";

export function dalaActions(store) {
  const dala = store.state.equipmentDetail;
  if (!dala) return `${pageHeader("Cadastros / Dalas", "Ações", "Carregando…")}`;
  const config = store.state.dalaActionConfig || { acoes: [], gatilhos: [] };
  const canManage = Boolean(config.can_manage);
  const actions = config.acoes || [];
  const triggers = config.gatilhos || [];
  const actionOptions = actions.map((item) => `<option value="${item.id}">${esc(item.rotulo)} (${esc(item.comando)})</option>`).join("");
  const actionRows = actions.length ? actions.map((item, index) => {
    const color = item.cor || "CINZA";
    const mode = item.modo || "DIRETO";
    const colorLabel = color[0] + color.slice(1).toLowerCase();
    const modeLabel = mode[0] + mode.slice(1).toLowerCase();
    return `<article class="dala-action-row">
      <div class="dala-action-order"><span>${item.ordem}</span>${canManage ? `<div class="dala-action-move"><button class="icon-button" data-action="move-dala-action" data-id="${item.id}" data-direction="up" type="button"${index === 0 ? " disabled" : ""} aria-label="Mover para cima">↑</button><button class="icon-button" data-action="move-dala-action" data-id="${item.id}" data-direction="down" type="button"${index === actions.length - 1 ? " disabled" : ""} aria-label="Mover para baixo">↓</button></div>` : ""}</div>
      <div class="dala-action-main"><strong>${esc(item.rotulo)}</strong><span>${esc(rotuloComando(item.comando))}</span></div>
      <div class="dala-action-meta"><span class="dala-action-tag"><i class="dala-color-swatch" data-color="${esc(color)}"></i>${esc(colorLabel)}</span><span class="dala-action-tag">${esc(modeLabel)}</span>${Number(item.visivel) ? '<span class="dala-action-tag is-visible">Na operação</span>' : '<span class="dala-action-tag is-hidden">Oculta</span>'}</div>
      ${canManage ? `<div class="dala-action-row-actions"><button class="text-link" data-action="edit-dala-action" data-id="${item.id}" type="button">Editar</button><button class="text-link danger-link" data-action="delete-dala-action" data-id="${item.id}" data-name="${esc(item.rotulo)}" type="button">Excluir</button></div>` : ""}
    </article>`;
  }).join("") : '<div class="dala-actions-empty">Nenhuma ação configurada.</div>';
  const triggerRows = triggers.length ? triggers.map((trigger) => `<article class="dala-trigger-row"><div><small>Evento</small><strong>${esc(rotuloEvento(trigger.evento))}</strong></div><div><small>Ação vinculada</small><strong>${esc(trigger.acao_rotulo || "Nenhuma ação")}</strong></div>${canManage ? `<button class="text-link" data-action="edit-dala-trigger" data-id="${trigger.id}" type="button">Editar</button>` : ""}</article>`).join("") : '<div class="dala-actions-empty">Nenhum gatilho configurado.</div>';
  const dalaLabel = dala.name || dala.equipment_code || "Dala";
  return `<div class="title-row with-actions dala-page-header dala-actions-page-header"><div><span class="dala-page-kicker">Cadastros / Dalas</span><h2>Ações da Dala</h2><p class="muted">${esc(dalaLabel)} <code>${esc(dala.equipment_code || "")}</code></p></div><div class="actions"><button class="button secondary page-back" data-action="back-dala" type="button">← Voltar</button></div></div>
  <section class="panel dala-actions-panel"><div class="dala-actions-section-head"><div><span class="dala-page-kicker">Comandos</span><h3>Botões da operação</h3><p class="muted">Escolha o que ficará disponível para o operador.</p></div>${canManage ? '<button class="button primary" data-action="new-dala-action" type="button">Nova ação</button>' : ""}</div><div class="dala-action-list">${actionRows}</div></section>
  <section class="panel dala-action-editor" hidden><div class="dala-editor-heading"><span class="dala-page-kicker">Configuração</span><h3>Detalhes da ação</h3></div><form id="dala-action-form"><input name="id" type="hidden" /><div class="dala-action-form-grid"><label>Comando<select name="comando" required><option value="INICIAR_CARREGAMENTO">Iniciar carregamento</option><option value="PAUSAR_CARREGAMENTO">Pausar carregamento</option><option value="REVERSAO_ATIVAR">Ativar reversão</option><option value="REVERSAO_DESATIVAR">Desativar reversão</option><option value="EMERGENCIA">Emergência</option></select></label><label>Texto do botão<input name="rotulo" maxlength="80" required /></label><label>Cor<select name="cor"><option value="VERDE">Verde</option><option value="VERMELHO">Vermelho</option><option value="CINZA">Cinza</option><option value="AMBAR">Âmbar</option><option value="AZUL">Azul</option></select></label><label>Modo<select name="modo"><option value="INCREMENTAL">Incremental</option><option value="DECREMENTAL">Decremental</option><option value="DIRETO">Direto</option></select></label><label class="checkbox-label"><input name="visivel" type="checkbox" checked /> Mostrar na operação</label></div><div class="actions"><button class="button primary" type="submit">Salvar ação</button><button class="button secondary" data-action="cancel-dala-action" type="button">Cancelar</button></div></form></section>
  <section class="panel dala-triggers-panel"><div class="dala-actions-section-head"><div><span class="dala-page-kicker">Automação</span><h3>Gatilho</h3><p class="muted">Ação executada quando a operação atingir 100%.</p></div>${canManage ? '<button class="button secondary" data-action="new-dala-trigger" type="button">Configurar gatilho</button>' : ""}</div><div class="dala-trigger-list">${triggerRows}</div></section>
  <section class="panel dala-trigger-editor" hidden><div class="dala-editor-heading"><span class="dala-page-kicker">Automação</span><h3>Configurar gatilho</h3></div><form id="dala-trigger-form"><input name="trigger_id" type="hidden" /><div class="dala-trigger-form-grid"><label>Evento<input value="Operação atingir 100%" disabled /></label><label>Ação<select name="acao_id"><option value="">Nenhuma ação</option>${actionOptions}</select></label></div><div class="actions"><button class="button primary" type="submit">Salvar gatilho</button><button class="button secondary" data-action="cancel-dala-trigger" type="button">Cancelar</button></div></form></section>`;
}

// Tela Editar Dala: mesmo formulário da criação, com dados preenchidos.
