import { esc, button } from "../funcoes/html.js";
import { dataHora } from "../funcoes/formato.js?v=202609170930";
import { pageHeader } from "../funcoes/view.js?v=202609150020";

export function errorLogs(store) {
  const rows = store.state.errorLogs || [];
  const diagnostic = store.state.technicalDiagnostics || {};
  const queue = diagnostic.queue || {};
  const disk = diagnostic.disk || {};
  const devices = Array.isArray(diagnostic.devices) ? diagnostic.devices : [];
  const commands = Array.isArray(diagnostic.commands) ? diagnostic.commands : [];
  const deadLetters = Array.isArray(store.state.deadLetters) ? store.state.deadLetters : [];
  const format = (value) => value ? dataHora(value) : "—";
  const deviceRows = devices.length ? devices.map((item) => `<tr><td>${esc(item.device_type)}</td><td>${item.active || 0} / ${item.total || 0}</td><td>${item.stale || 0}</td><td>${esc(format(item.last_seen_at))}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-cell">Nenhum dispositivo registrado.</td></tr>';
  const commandRows = commands.length ? commands.map((item) => `<tr><td>${esc(format(item.requested_at))}</td><td><code>${esc(item.command)}</code></td><td>${esc(item.status)}</td><td>${esc(item.response_message || "—")}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-cell">Nenhum comando recente.</td></tr>';
  const deadLetterRows = deadLetters.length ? deadLetters.map((item) => `<tr><td><code>${esc(item.event_uuid)}</code><small>${esc(format(item.moved_at))}</small></td><td>${esc(item.event_type)}</td><td>${esc(item.failed_attempts)}</td><td class="error-message-cell">${esc(item.last_error)}</td><td><button class="button secondary" data-action="requeue-dead-letter" data-id="${esc(item.id)}" type="button">Reenfileirar</button> <button class="button ghost" data-action="resolve-dead-letter" data-id="${esc(item.id)}" type="button">Resolver</button></td></tr>`).join("") : '<tr><td colspan="5" class="empty-cell">Nenhum evento aguardando análise.</td></tr>';
  return `${pageHeader("Sistema / diagnóstico", "Painel técnico", "Visão operacional para investigar banco, sincronização, dispositivos, comandos e espaço em disco.", button("Atualizar", "reload-error-logs", "secondary"))}
  <section class="grid four dashboard-metrics"><div class="panel metric"><small>Banco</small><strong>${esc(diagnostic.database?.status || "—")}</strong></div><div class="panel metric"><small>Fila pendente</small><strong>${queue.pending || 0}</strong><span>${queue.errors || 0} erro(s)</span></div><div class="panel metric"><small>Fila morta</small><strong>${diagnostic.dead_letter_pending || 0}</strong><span>evento(s) aguardando análise</span></div><div class="panel metric"><small>Disco livre</small><strong>${disk.free_percent == null ? "—" : `${disk.free_percent}%`}</strong><span>${esc(diagnostic.release?.commit || "commit desconhecido")}</span></div></section><br>
  <section class="panel reference-table-panel"><h3>Dispositivos e comunicação</h3><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Ativos</th><th>Sem sinal</th><th>Último heartbeat</th></tr></thead><tbody>${deviceRows}</tbody></table></div></section><br>
  <section class="panel reference-table-panel"><h3>Últimos comandos ao gateway</h3><div class="table-wrap"><table><thead><tr><th>Solicitado</th><th>Comando</th><th>Status</th><th>Retorno</th></tr></thead><tbody>${commandRows}</tbody></table></div></section><br>
  <section class="panel reference-table-panel"><div class="panel-heading"><div><h3>Fila morta de sincronização</h3><p class="muted">Reenfileire somente depois de corrigir a causa do erro. Toda ação fica registrada na auditoria.</p></div></div><div class="table-wrap"><table><thead><tr><th>Evento</th><th>Tipo</th><th>Tentativas</th><th>Último erro</th><th>Ação</th></tr></thead><tbody>${deadLetterRows}</tbody></table></div></section><br>
  <section class="panel compact-help"><strong>Proteção de dados</strong><p>Senhas, tokens, sessões e conteúdo de formulários não são armazenados neste histórico.</p></section><br>
  <section class="panel reference-table-panel"><div class="table-wrap"><table class="error-logs-table"><thead><tr><th>Data</th><th>Origem</th><th>Mensagem</th><th>Empresa</th><th>Usuário</th></tr></thead><tbody>${rows.length ? rows.map((item) => `<tr><td>${esc(format(item.criado_em))}</td><td><code>${esc(item.origem)}</code></td><td class="error-message-cell">${esc(item.mensagem)}</td><td>${esc(item.empresa || "Sistema")}</td><td>${esc(item.usuario || "—")}</td></tr>`).join("") : '<tr><td colspan="5" class="empty-cell">Nenhum erro inesperado registrado.</td></tr>'}</tbody></table></div></section>`;
}
