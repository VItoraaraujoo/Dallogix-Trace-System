import { button, esc } from "../funcoes/html.js";
import { pageHeader, companyGrid } from "../funcoes/view.js?v=202609162400";

export function companies(store) {
  const rows = store.state.companies || [];
  const activation = store.state.companyActivation;
  const totalMachines = rows.reduce(
    (sum, company) => sum + Number(company.total_machines || 0),
    0,
  );
  const totalOnline = rows.reduce(
    (sum, company) => sum + Number(company.machines_online || 0),
    0,
  );
  const totalUsers = rows.reduce(
    (sum, company) => sum + Number(company.total_users || 0),
    0,
  );
  const activeUsers = rows.reduce(
    (sum, company) => sum + Number(company.active_users || 0),
    0,
  );
  const activationPanel = activation ? `<section class="panel company-activation-panel" role="status"><div><span class="kicker">Empresa criada</span><h3>Código de ativação da empresa</h3><p>Guarde este código. Ele será informado uma vez no PC industrial para configurar esta instalação.</p><strong class="company-activation-code">${activation.activation_code ? esc(activation.activation_code) : "Código gerado"}</strong><small>Empresa: ${esc(activation.name)} · Login: @${esc(activation.login_domain)}</small></div>${activation.activation_code ? `<button class="button secondary" data-action="copy-company-activation" data-code="${esc(activation.activation_code)}" type="button">Copiar código</button>` : ""}</section><br>` : "";
  return `${pageHeader("Dallogix / administração global", "Empresas", "Acompanhe empresas, conectividade e acessos. A operação das máquinas permanece isolada em cada empresa.")}<section class="panel"><h3>Nova empresa</h3><form id="company-create-form"><div class="grid two"><label>Nome da empresa<input name="name" maxlength="160" required placeholder="Nome comercial" /></label></div><div class="actions">${button("Criar empresa", "create-company")}</div><p class="form-feedback" data-form-feedback role="status" aria-live="polite" hidden></p></form></section><br>${activationPanel}<div class="grid four dashboard-metrics"><div class="panel metric"><small>Empresas</small><strong>${rows.length}</strong></div><div class="panel metric"><small>Máquinas online</small><strong class="metric-green">${totalOnline} / ${totalMachines}</strong></div><div class="panel metric"><small>Acessos ativos</small><strong>${activeUsers} / ${totalUsers}</strong></div><div class="panel metric"><small>Sem sinal</small><strong class="${totalMachines - totalOnline > 0 ? "metric-red" : ""}">${totalMachines - totalOnline}</strong></div></div><br>${companyGrid(rows)}<br><section class="panel compact-help"><strong>Próximo passo ao cadastrar uma empresa</strong><p>Abra a empresa criada, entre em <b>Logins</b> e crie o primeiro administrador da empresa. Supervisores e usuários operacionais são criados pelo administrador daquela empresa.</p></section>`;
}
