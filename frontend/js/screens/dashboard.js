import { pageHeader } from '../functions/view.js';
import { esc, button } from '../functions/html.js';

export function dashboard(store) {
  const equipments = store.state.equipments || [];
  const devices = store.state.monitoring?.dispositivos || [];
  const statusFor = (equipment) => devices.find((device) => device.equipment_code === equipment.equipment_code && device.device_type === 'CLP') || null;
  const online = equipments.filter((equipment) => statusFor(equipment)?.status === 'ONLINE').length;
  const offline = equipments.length - online;
  return `${pageHeader('Visão geral','Dashboard','Acompanhe os principais indicadores da empresa.',button('Configurações','settings','secondary'))}<div class="grid four dashboard-metrics"><div class="panel metric"><small>Total de máquinas</small><strong>${equipments.length}</strong></div><div class="panel metric"><small>Máquinas online</small><strong class="dashboard-green">${online}</strong></div><div class="panel metric"><small>Máquinas sem sinal</small><strong class="dashboard-red">${offline}</strong></div><div class="panel metric"><small>Estado do carregamento</small><strong>${store.state.operationalState}</strong></div></div><br><section class="panel"><div class="panel-heading"><h3>Máquinas da empresa</h3><button class="text-link" data-action="dalas">Gerenciar Dalas</button></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Identificador</th><th>IP do CLP</th><th>Porta do CLP</th><th>Status</th><th>Último sinal</th></tr></thead><tbody>${equipments.length ? equipments.map((equipment) => { const status = statusFor(equipment); const statusText = status?.status || 'NÃO REGISTRADO'; return `<tr><td><strong>${esc(equipment.name)}</strong></td><td>${esc(equipment.equipment_code)}</td><td>${esc(equipment.plc_ip || 'Não configurado')}</td><td>${equipment.plc_port || '—'}</td><td><span class="badge ${statusText === 'ONLINE' ? 'green' : statusText === 'ERRO' ? 'red' : 'yellow'}">${esc(statusText)}</span></td><td>${esc(status?.last_seen_at || '—')}</td></tr>`; }).join('') : '<tr><td colspan="6" class="empty-cell">Nenhuma máquina cadastrada.</td></tr>'}</tbody></table></div></section>`;
}
