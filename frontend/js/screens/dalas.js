import { button } from '../functions/html.js';
import { pageHeader } from '../functions/view.js';
import { esc } from '../functions/html.js';

export function dalas(store) {
  const rows = store.state.equipments || [];
  const devices = store.state.monitoring?.dispositivos || [];
  const statusFor = (equipment) => devices.find((device) => device.equipment_code === equipment.equipment_code && device.device_type === 'CLP');
  return `${pageHeader('Cadastros / máquinas','Dalas','Cadastre e acompanhe os pontos de comunicação da fábrica.',button('Nova dala','new-dala'))}<section class="panel reference-table-panel"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Identificador</th><th>IP do CLP</th><th>Porta do CLP</th><th>Porta externa</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows.length ? rows.map((equipment) => { const status = statusFor(equipment)?.status || 'Verificando status…'; return `<tr><td>${esc(equipment.name)}</td><td>${esc(equipment.equipment_code)}</td><td>${esc(equipment.plc_ip || '—')}</td><td>${equipment.plc_port || '—'}</td><td>${equipment.external_port || '—'}</td><td><span class="badge ${status === 'ONLINE' ? 'green' : 'yellow'}">${esc(status)}</span></td><td>${button('Visualizar','dashboard','secondary')}${button('Editar','settings','ghost')}</td></tr>`; }).join('') : '<tr><td colspan="7" class="empty-cell">Nenhuma Dala cadastrada.</td></tr>'}</tbody></table></div></section>${store.state.page === 'dalas' ? `<section class="panel compact-help"><strong>Comunicação</strong><p>O CLP permanece responsável pelo controle físico. O Trace acompanha o status e usa o gateway industrial para a comunicação Ethernet.</p></section>` : ''}`;
}
