export class TraceStore {
  constructor() {
    this.state = { page: 'manifests', loaded: 2435, planned: 3000, running: false, emergency: false, returnMode: false, loadingId: null, operationalState: 'AGUARDANDO', truck: '—', romaneio: '—', monitoring: null, products: [], userRole: null };
    this.csrfToken = '';
    this.state.configuration = null;
    this.state.equipments = [];
    this.manifests = [
      ['04/03/2026', '1025', 'ABC1234', 'Em andamento', '2.435'],
      ['04/03/2026', '1024', 'DEF5678', 'Em andamento', '4.500'],
      ['03/03/2026', '1023', 'GHI3456', 'Finalizado', '3.100'],
      ['03/03/2026', '1022', 'JKL6547', 'Cancelado', '1.800'],
    ];
  }
  navigate(page) { this.state.page = page; }
  setUser(user) { this.state.userRole = user?.role || null; }
  setCsrfToken(token) { this.csrfToken = token || ''; }
  jsonHeaders() { return { 'Content-Type': 'application/json', ...(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}) }; }
  async loadManifests() {
    const response = await fetch('/api/romaneios.php');
    if (!response.ok) return;
    const result = await response.json();
    this.manifests = result.data.map((manifest) => [
      manifest.scheduled_date.split('-').reverse().join('/'),
      manifest.number,
      `${manifest.trucks_count} caminhão(ões)`,
      manifest.status,
      Number(manifest.planned_quantity).toLocaleString('pt-BR'),
    ]);
  }
  async loadActiveLoading() {
    const response = await fetch('/api/carregamentos.php');
    if (!response.ok) return;
    const result = await response.json();
    const loading = result.data?.[0];
    if (!loading) return;
    this.state.loadingId = Number(loading.id);
    this.state.operationalState = loading.state;
    this.state.emergency = loading.state === 'EMERGENCIA';
    this.state.planned = Number(loading.planned_quantity) || this.state.planned;
    this.state.loaded = Number(loading.valid_readings) || 0;
    this.state.truck = loading.plate;
    this.state.romaneio = loading.romaneio_number;
  }
  async changeLoadingState(target) {
    if (!this.state.loadingId) throw new Error('Nenhum carregamento ativo encontrado.');
    const response = await fetch('/api/estado_carregamento.php', { method: 'PATCH', headers: this.jsonHeaders(), body: JSON.stringify({ carregamento_id: this.state.loadingId, state: target }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível alterar o estado.');
    this.state.operationalState = result.data.state;
    this.state.running = ['CARREGANDO', 'FINALIZANDO'].includes(result.data.state);
    this.state.emergency = result.data.state === 'EMERGENCIA';
  }
  async unlockMachine() {
    if (!this.state.loadingId) throw new Error('Nenhum carregamento ativo encontrado.');
    const response = await fetch('/api/desbloquear_maquina.php', { method: 'POST', headers: this.jsonHeaders(), body: JSON.stringify({ carregamento_id: this.state.loadingId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível desbloquear a máquina.');
    this.state.operationalState = result.data.state;
    this.state.running = false;
    this.state.emergency = false;
  }
  async finishLoading() { if (!this.state.loadingId) throw new Error('Nenhum carregamento ativo encontrado.'); const response = await fetch('/api/encerrar_carregamento.php', { method: 'POST', headers: this.jsonHeaders(), body: JSON.stringify({ carregamento_id: this.state.loadingId }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível finalizar o carregamento.'); this.state.operationalState = 'FINALIZADO'; this.state.running = false; await this.loadMonitoring(); }
  async loadMonitoring() {
    const response = await fetch('/api/monitoramento.php');
    if (response.ok) this.state.monitoring = (await response.json()).data;
  }
  async loadProducts() {
    const response = await fetch('/api/produtos.php');
    if (response.ok) this.state.products = (await response.json()).data;
  }
  async loadConfiguration() { const response = await fetch('/api/configuracoes.php'); if (response.ok) this.state.configuration = (await response.json()).data; }
  async loadEquipments() { const response = await fetch('/api/equipamentos.php'); if (response.ok) this.state.equipments = (await response.json()).data; }
  async saveConfiguration(data) { const response = await fetch('/api/configuracoes.php', { method: 'PUT', headers: this.jsonHeaders(), body: JSON.stringify(data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a configuração.'); await this.loadConfiguration(); }
  async createEquipment(data) { const response = await fetch('/api/equipamentos.php', { method: 'POST', headers: this.jsonHeaders(), body: JSON.stringify(data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível cadastrar a Dala.'); await this.loadConfiguration(); }
  async createOccurrence(data) {
    const response = await fetch('/api/ocorrencias.php', { method: 'POST', headers: this.jsonHeaders(), body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a ocorrência.');
    await this.loadMonitoring();
  }
  toggleRun() { this.state.running = !this.state.running; if (this.state.running) this.state.loaded = Math.min(this.state.planned, this.state.loaded + 1); }
  stop() { this.state.running = false; }
  toggleReturn() { this.state.returnMode = !this.state.returnMode; }
  async createProduct(data) { const response = await fetch('/api/produtos.php', { method: 'POST', headers: this.jsonHeaders(), body: JSON.stringify(data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível cadastrar o produto.'); await this.loadProducts(); }
  activateEmergency() { this.state.emergency = true; }
}
