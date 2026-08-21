import { pageHeader } from '../functions/view.js';
import { esc, button } from '../functions/html.js';

export function dashboard(store) {
  const equipments = store.state.equipments || [];
  const devices = store.state.monitoring?.dispositivos || [];
  const statusFor = (equipment) => devices.find((device) => device.equipment_code === equipment.equipment_code && device.device_type === 'CLP') || null;
  const online = equipments.filter((equipment) => statusFor(equipment)?.status === 'ONLINE').length;
  const offline = equipments.length - online;
  return `${pageHeader('Visão geral / empresa','Dashboard','Acompanhe todas as máquinas e os principais dados de comunicação.',button('Configurações','settings','secondary'))}<div class="grid four"><div class="panel metric"><small>Total de máquinas</small><strong>${equipments.length}</strong></div><div class="panel metric"><small>Online</small><strong class="dashboard-green">${online}</strong></div><div class="panel metric"><small>Sem sinal</small><strong class="dashboard-red">${offline}</strong></div><div class="panel metric"><small>Carregamento atual</small><strong>${store.state.operationalState}</strong></div></div><br><section class="panel"><h3>Máquinas da empresa</h3><div class="table-wrap"><table><thead><tr><th>Máquina</th><th>Identificador</th><th>IP do CLP</th><th>Comunicação</th><th>Porta</th><th>Status</th><th>Último sinal</th></tr></thead><tbody>${equipments.length ? equipments.map((equipment) => { const status = statusFor(equipment); const statusText = status?.status || 'NÃO REGISTRADO'; return `<tr><td><strong>${esc(equipment.name)}</strong></td><td>${esc(equipment.equipment_code)}</td><td>${esc(equipment.plc_ip || 'Não configurado')}</td><td>${esc(equipment.plc_protocol || 'MODBUS_TCP')}</td><td>${equipment.plc_port || '—'}</td><td><span class="badge ${statusText === 'ONLINE' ? 'green' : statusText === 'ERRO' ? 'red' : 'yellow'}">${statusText}</span></td><td>${esc(status?.last_seen_at || '—')}</td></tr>`; }).join('') : '<tr><td colspan="7">Nenhuma máquina cadastrada.</td></tr>'}</tbody></table></div></section>`;
}
