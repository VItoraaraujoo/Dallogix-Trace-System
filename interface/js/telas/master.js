import { button, esc } from "../funcoes/html.js";
import { companyGrid, pageHeader } from "../funcoes/view.js";

function formatDate(value) {
  return value ? String(value).replace(" ", " • ").split(".")[0] : "—";
}

export function masterHome(store) {
  const companies = Array.isArray(store.state.companies) ? store.state.companies : [];
  const logs = Array.isArray(store.state.errorLogs) ? store.state.errorLogs : [];
  const totalMachines = companies.reduce(
    (total, company) => total + Number(company.total_machines || 0),
    0,
  );
  const onlineMachines = companies.reduce(
    (total, company) => total + Number(company.machines_online || 0),
    0,
  );
  const blockedLicenses = companies.filter(
    (company) => String(company.license_status || "SEM_LICENCA") !== "ATIVA",
  ).length;
  const affectedCompanies = companies.filter((company) => {
    const total = Number(company.total_machines || 0);
    const online = Number(company.machines_online || 0);
    return total > online || String(company.license_status || "SEM_LICENCA") !== "ATIVA";
  });
  const visibleCompanies = affectedCompanies.length ? affectedCompanies : companies;
  const attentionLabel = affectedCompanies.length
    ? `${affectedCompanies.length} empresa(s) precisam de atenção`
    : "Todas as empresas estão em condição normal";
  const attentionText = affectedCompanies.length
    ? "Verifique conectividade das máquinas ou a situação da licença antes de abrir a operação."
    : "Nenhuma máquina sem sinal ou licença bloqueada foi identificada nesta consulta.";

  return `${pageHeader(
    "Dallogix / administração global",
    "Central Master",
    "Acompanhe as empresas, priorize pendências e entre na gestão correta sem acessar a operação local.",
    `<div class="actions master-header-actions">${button("Empresas", "goto-companies", "secondary")}${button("Logs de erros", "goto-error-logs", "secondary")}</div>`,
  )}
  <section class="master-watch ${affectedCompanies.length ? "has-attention" : "is-clear"}" aria-live="polite">
    <div class="master-watch-marker" aria-hidden="true">${affectedCompanies.length ? "!" : "✓"}</div>
    <div><span class="kicker">Monitoramento das instalações</span><strong>${esc(attentionLabel)}</strong><p>${esc(attentionText)}</p></div>
    <button class="button secondary small" data-action="reload-master-home" type="button">Atualizar visão</button>
  </section>
  <section class="grid four dashboard-metrics master-metrics" aria-label="Resumo das empresas">
    <div class="panel metric"><small>Empresas cadastradas</small><strong>${companies.length}</strong></div>
    <div class="panel metric"><small>Máquinas conectadas</small><strong class="metric-green">${onlineMachines} / ${totalMachines}</strong></div>
    <div class="panel metric"><small>Empresas em atenção</small><strong class="${affectedCompanies.length ? "metric-red" : "metric-green"}">${affectedCompanies.length}</strong></div>
    <div class="panel metric"><small>Licenças bloqueadas</small><strong class="${blockedLicenses ? "metric-red" : "metric-green"}">${blockedLicenses}</strong></div>
  </section>
  <section class="master-section-heading"><div><span class="kicker">Acesso rápido</span><h3>${affectedCompanies.length ? "Empresas que precisam de verificação" : "Empresas cadastradas"}</h3><p>${affectedCompanies.length ? "As empresas com máquina sem sinal ou licença bloqueada aparecem primeiro." : "Abra uma empresa para gerenciar máquinas, usuários e licenças."}</p></div>${button("Ver todas as empresas", "goto-companies", "secondary")}</section>
  ${companyGrid(visibleCompanies, "Nenhuma empresa cadastrada.")}
  <section class="master-section-heading master-log-heading"><div><span class="kicker">Diagnóstico</span><h3>Últimos erros registrados</h3><p>Use este histórico para rastrear falhas durante testes e atendimento.</p></div>${button("Abrir histórico completo", "goto-error-logs", "secondary")}</section>
  <section class="panel reference-table-panel master-log-preview"><div class="table-wrap"><table><thead><tr><th>Data</th><th>Origem</th><th>Mensagem</th><th>Empresa</th></tr></thead><tbody>${logs.length ? logs.slice(0, 5).map((item) => `<tr><td>${esc(formatDate(item.criado_em))}</td><td><code>${esc(item.origem || "Sistema")}</code></td><td class="error-message-cell">${esc(item.mensagem || "—")}</td><td>${esc(item.empresa || "Sistema")}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-cell">Nenhum erro inesperado registrado.</td></tr>'}</tbody></table></div></section>`;
}
