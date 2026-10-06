import { OfflineOperationBuffer, secureRandomId } from "./OfflineOperationBuffer.js?v=20260930-security01";
import { ClienteApi, erroRespostaHttp } from "../api/ClienteApi.js?v=202610060001";
import { ServicoSincronizacao } from "../servicos/ServicoSincronizacao.js?v=202610060003";

export class ArmazenamentoTrace {
  constructor() {
    this.state = {
      page: "manifests",
      loaded: 0,
      detectedBags: 0,
      planned: 0,
      running: false,
      emergency: false,
      returnMode: false,
      loadingId: null,
      selectedLoadingId: null,
      activeLoadings: [],
      loadingItems: [],
      operationalState: "AGUARDANDO",
      truck: "—",
      romaneio: "—",
      equipmentCode: "—",
      equipmentId: null,
      monitoring: null,
      monitoringUpdatedAt: null,
      syncStatus: null,
      products: [],
      productsLoaded: false,
      users: [],
      userRole: null,
      companyLoginDomain: null,
      configuration: null,
      equipments: [],
      equipmentsLoaded: false,
      equipmentsLoading: false,
      equipmentsError: "",
      dalaStatuses: [],
      companies: [],
      companyDetail: null,
      industrialInstallations: [],
      industrialEquipmentOptions: [],
      industrialInstallationActivation: null,
      selectedCompanyId: null,
      manifestFilters: {
        date_from: "",
        date_to: "",
        number: "",
        expedidor: "",
        status: "",
      },
      manifestPage: 1,
      manifestMeta: { page: 1, per_page: 50, total: 0, pages: 0 },
      dashboard: null,
      manifestDetail: null,
      equipmentDetail: null,
      companyActivation: null,
      localActivation: null,
      dalaCommands: [],
      dalaActionConfig: { acoes: [], gatilhos: [], can_manage: false },
      errorLogs: [],
      technicalDiagnostics: null,
      deadLetters: [],
      plcCommand: null,
      commandInFlight: false,
      productFormOpen: false,
      dalaFormOpen: false,
      editingProductId: null,
      productSearch: "",
      loadErrors: [],
      pendingReadings: [],
      offlineQueueSize: 0,
    };
    this.csrfToken = "";
    this.api = new ClienteApi();
    this.manifests = [];
    this.offlineBuffer = new OfflineOperationBuffer();
    this.sincronizacao = new ServicoSincronizacao({ api: this.api, offlineBuffer: this.offlineBuffer });
    // Consultas do carregamento e eventos em tempo real podem chegar juntas.
    // A fila garante que uma resposta antiga não sobrescreva a mais recente.
    this.activeLoadingRefresh = Promise.resolve();
    this.commandStatusRefresh = Promise.resolve();
  }
  navigate(page) {
    this.state.page = page;
  }
  setUser(user) {
    this.offlineBuffer.setOwner(user);
    this.state.userRole = user?.role || null;
    this.state.currentUserId = user?.id || null;
    this.state.companyLoginDomain = user?.company_login_domain || null;
  }
  setCsrfToken(token) {
    this.csrfToken = token || "";
  }
  jsonHeaders() {
    return {
      "Content-Type": "application/json",
      ...(this.csrfToken ? { "X-CSRF-Token": this.csrfToken } : {}),
    };
  }
  async jsonResponse(response, fallback) {
    const result = await response.json().catch(() => ({}));
    if (response.ok) return result;
    const error = await erroRespostaHttp(response, result.error || fallback);
    throw error || new Error(result.error || fallback);
  }
  canQueueOffline(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    return ["POST", "PUT", "PATCH"].includes(method) &&
      ["/api/identificar_leitura.php", "/api/retornos.php"].some((path) => url.startsWith(path)) &&
      typeof options.body === "string";
  }
  async requestWithOfflineQueue(url, options = {}) {
    const queueable = this.canQueueOffline(url, options);
    const eventId = queueable ? secureRandomId() : null;
    const requestOptions = queueable
      ? { ...options, headers: { ...(options.headers || {}), "X-Trace-Offline-Id": eventId } }
      : options;
    try {
      return await this.api.fetch(url, requestOptions);
    } catch (error) {
      if (!queueable) throw error;
      const id = await this.offlineBuffer.enqueue({
        url,
        method: options.method || "POST",
        headers: options.headers || {},
        body: options.body,
        eventId,
      });
      this.state.offlineQueueSize = (await this.offlineBuffer.all()).length;
      return new Response(JSON.stringify({
        data: { queued: true, offline_id: id },
        message: "Operação guardada e será enviada quando a conexão voltar.",
      }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
  }
  async flushOfflineOperations() {
    const result = await this.sincronizacao.enviarPendencias(this.jsonHeaders());
    this.state.offlineQueueSize = result.pending;
    return result;
  }
  subscribeOperationalEvents(onData, onError) {
    return this.sincronizacao.assinarEventos({ onData, onError });
  }
  async loadManifests() {
    const params = new URLSearchParams();
    Object.entries(this.state.manifestFilters || {}).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const page = Math.max(1, Number(this.state.manifestPage) || 1);
    params.set("page", String(page));
    params.set("per_page", "50");
    const query = params.toString();
    const response = await this.api.fetch(
      `/api/romaneios.php${query ? `?${query}` : ""}`,
    );
    const result = await this.jsonResponse(response, "Não foi possível carregar os romaneios.");
    this.manifests = result.data || [];
    this.state.manifestMeta = result.meta || {
      page,
      per_page: 50,
      total: this.manifests.length,
      pages: this.manifests.length ? 1 : 0,
    };
  }
  async applyManifestFilters(raw) {
    this.state.manifestPage = 1;
    this.state.manifestFilters = {
      date_from: String(raw.date_from || "").trim(),
      date_to: String(raw.date_to || "").trim(),
      number: String(raw.number || "").trim(),
      expedidor: String(raw.expedidor || "").trim(),
      status: String(raw.status || "").trim(),
    };
    await this.loadManifests();
  }
  async clearManifestFilters() {
    this.state.manifestPage = 1;
    this.state.manifestFilters = {
      date_from: "",
      date_to: "",
      number: "",
      expedidor: "",
      status: "",
    };
    await this.loadManifests();
  }
  async setManifestPage(page) {
    const pages = Math.max(1, Number(this.state.manifestMeta?.pages) || 1);
    this.state.manifestPage = Math.min(pages, Math.max(1, Number(page) || 1));
    await this.loadManifests();
  }
  async loadDashboard() {
    const response = await this.api.fetch("/api/dashboard.php");
    this.state.dashboard = (await this.jsonResponse(response, "Não foi possível carregar o painel.")).data;
  }
  async loadManifest(id) {
    const response = await this.api.fetch(`/api/romaneios.php?id=${id}`);
    const result = await this.jsonResponse(response, "Romaneio não encontrado.");
    this.state.manifestDetail = result.data;
  }
  async createManifest(payload) {
    const response = await this.api.fetch("/api/romaneios.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await this.jsonResponse(response, "Não foi possível salvar o romaneio.");
    await this.loadManifests();
    return result.data;
  }
  async updateManifest(payload) {
    const response = await this.api.fetch("/api/romaneios.php", {
      method: "PATCH",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ action: "update", ...payload }),
    });
    const result = await this.jsonResponse(response, "Não foi possível atualizar o romaneio.");
    await this.loadManifests();
    return result.data;
  }
  async prepareLoading(payload) {
    const response = await this.api.fetch("/api/carregamentos.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await this.jsonResponse(response, "Não foi possível preparar o carregamento.");
    this.state.selectedLoadingId = Number(result.data.id);
    await this.loadActiveLoading(this.state.selectedLoadingId);
    return result.data;
  }
  async reassignLoading(loadingId, equipmentId) {
    const response = await this.api.fetch("/api/carregamentos.php", {
      method: "PATCH",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        carregamento_id: Number(loadingId),
        equipment_id: Number(equipmentId),
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível vincular a nova Dala.");
    await this.loadEquipments({ force: true });
    await this.loadActiveLoading(Number(loadingId));
    return result.data;
  }
  async importPdf(formData) {
    const response = await this.api.fetch("/api/importar_pdf.php", {
      method: "POST",
      headers: this.csrfToken ? { "X-CSRF-Token": this.csrfToken } : {},
      body: formData,
    });
    const result = await this.jsonResponse(response, "Falha ao importar o PDF.");
    return result.data;
  }
  async loadEquipment(id) {
    const response = await this.api.fetch(`/api/equipamentos.php?id=${id}`);
    const result = await this.jsonResponse(response, "Dala não encontrada.");
    this.state.equipmentDetail = result.data;
  }
  async checkEquipmentStatus(id) {
    const response = await this.api.fetch(`/api/equipamentos.php?id=${id}&check=status`);
    if (!response.ok)
      return {
        status: "DESCONHECIDO",
        message: (await response.json().catch(() => ({}))).error || "Falha na verificação.",
      };
    const result = await response.json();
    return result.data;
  }
  async loadDalaStatuses() {
    const response = await this.api.fetch("/api/status_dalas.php");
    const result = await this.jsonResponse(response, "Não foi possível carregar o status das Dalas.");
    this.state.dalaStatuses = Array.isArray(result.data) ? result.data : [];
    return this.state.dalaStatuses;
  }
  async loadDalaCommandHistory(id) {
    const response = await this.api.fetch(`/api/comandos_industriais.php?equipment_id=${encodeURIComponent(id)}`);
    const result = await this.jsonResponse(response, "Não foi possível carregar o diagnóstico do CLP.");
    this.state.dalaCommands = Array.isArray(result.data) ? result.data : [];
    return this.state.dalaCommands;
  }
  async loadDalaActionConfig(id) {
    const response = await this.api.fetch(`/api/acoes_dala.php?equipment_id=${encodeURIComponent(id)}`);
    const result = await this.jsonResponse(response, "Não foi possível carregar as ações da Dala.");
    this.state.dalaActionConfig = result.data || { acoes: [], gatilhos: [], can_manage: false };
    return this.state.dalaActionConfig;
  }
  async saveDalaAction(id, payload) {
    const method = payload.id ? "PATCH" : "POST";
    const response = await this.api.fetch(`/api/acoes_dala.php?equipment_id=${encodeURIComponent(id)}`, {
      method,
      headers: this.jsonHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await this.jsonResponse(response, "Não foi possível salvar a ação.");
    return this.loadDalaActionConfig(id);
  }
  async reorderDalaActions(id, ids) {
    const response = await this.api.fetch(`/api/acoes_dala.php?equipment_id=${encodeURIComponent(id)}`, {
      method: "PATCH", headers: this.jsonHeaders(), body: JSON.stringify({ action: "reorder", ids }),
    });
    const result = await this.jsonResponse(response, "Não foi possível ordenar as ações.");
    return this.loadDalaActionConfig(id);
  }
  async deleteDalaAction(equipmentId, actionId) {
    const response = await this.api.fetch(`/api/acoes_dala.php?equipment_id=${encodeURIComponent(equipmentId)}&id=${encodeURIComponent(actionId)}`, {
      method: "DELETE", headers: this.jsonHeaders(),
    });
    const result = await this.jsonResponse(response, "Não foi possível excluir a ação.");
    return this.loadDalaActionConfig(equipmentId);
  }
  async saveDalaTrigger(equipmentId, payload) {
    const response = await this.api.fetch(`/api/acoes_dala.php?equipment_id=${encodeURIComponent(equipmentId)}`, {
      method: "PATCH", headers: this.jsonHeaders(), body: JSON.stringify({ action: "trigger", ...payload }),
    });
    const result = await this.jsonResponse(response, "Não foi possível salvar o gatilho.");
    return this.loadDalaActionConfig(equipmentId);
  }
  async loadErrorLogs() {
    const response = await this.api.fetch("/api/logs_erros.php");
    const result = await this.jsonResponse(response, "Não foi possível carregar os logs de erro.");
    this.state.errorLogs = result.data || [];
    return this.state.errorLogs;
  }
  async loadTechnicalDiagnostics() {
    const response = await this.api.fetch("/api/diagnostico.php");
    const result = await this.jsonResponse(response, "Não foi possível carregar o diagnóstico técnico.");
    this.state.technicalDiagnostics = result.data || null;
    return this.state.technicalDiagnostics;
  }
  async loadDeadLetters() {
    const response = await this.api.fetch("/api/sync_dead_letter.php");
    const result = await this.jsonResponse(response, "Não foi possível carregar a fila morta.");
    this.state.deadLetters = result.data || [];
    return this.state.deadLetters;
  }
  async updateDeadLetter(id, action, resolutionNote) {
    const response = await this.api.fetch(`/api/sync_dead_letter.php?id=${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ id, action, resolution_note: resolutionNote }),
    });
    const result = await this.jsonResponse(response, "Não foi possível atualizar a fila morta.");
    await Promise.all([this.loadDeadLetters(), this.loadTechnicalDiagnostics()]);
    return result.data;
  }
  async updateEquipment(data) {
    const response = await this.api.fetch("/api/equipamentos.php", {
      method: "PUT",
      headers: this.jsonHeaders(),
      body: JSON.stringify(data),
    });
    const result = await this.jsonResponse(response, "Não foi possível salvar a Dala.");
    await this.loadEquipments({ force: true });
  }
  async deleteEquipment(id) {
    const response = await this.api.fetch(`/api/equipamentos.php?id=${id}`, {
      method: "DELETE",
      headers: this.jsonHeaders(),
    });
    const result = await this.jsonResponse(response, "Não foi possível excluir a Dala.");
    await this.loadEquipments({ force: true });
  }
  updateProduct(data) {
    return this.requestJson("/api/produtos.php", "PUT", data);
  }
  deleteProduct(id) {
    return this.requestJson(`/api/produtos.php?id=${id}`, "DELETE", {});
  }
  async requestJson(url, method, body) {
    const response = await this.api.fetch(url, {
      method,
      headers: this.jsonHeaders(),
      body: method === "DELETE" ? undefined : JSON.stringify(body),
    });
    const result = await this.jsonResponse(response, "Falha na requisição.");
    await this.loadProducts();
    return result.data;
  }
  async loadActiveLoading(selectedId = this.state.selectedLoadingId) {
    const refresh = this.activeLoadingRefresh
      .catch(() => {})
      .then(() => this._loadActiveLoading(selectedId));
    this.activeLoadingRefresh = refresh.catch(() => {});
    return refresh;
  }
  async _loadActiveLoading(selectedId = this.state.selectedLoadingId) {
    const response = await this.api.fetch("/api/carregamentos.php");
    const result = await this.jsonResponse(response, "Não foi possível carregar o carregamento ativo.");
    const loadings = Array.isArray(result.data) ? result.data : [];
    this.state.activeLoadings = loadings.filter(
      (item) => item.state !== "FINALIZADO",
    );
    const requestedId = Number(selectedId) || null;
    const requestedLoading = this.state.activeLoadings.find(
      (item) => Number(item.id) === requestedId,
    );
    const loading = requestedLoading?.equipment_id
      ? requestedLoading
      : (requestedId
        ? null
        : (this.state.activeLoadings.length === 1 && this.state.activeLoadings[0]?.equipment_id
          ? this.state.activeLoadings[0]
          : null));
    if (!loading) {
      this.state.loadingId = null;
      this.state.selectedLoadingId = null;
      this.state.returnMode = false;
      this.state.loaded = 0;
      this.state.detectedBags = 0;
      this.state.planned = 0;
      this.state.running = false;
      this.state.emergency = false;
      this.state.operationalState = "AGUARDANDO";
      this.state.truck = "—";
      this.state.romaneio = "—";
      this.state.equipmentCode = "—";
      this.state.equipmentId = null;
      this.state.plcCommand = null;
      this.state.loadingItems = [];
      return;
    }
    this.state.loadingId = Number(loading.id);
    this.state.selectedLoadingId = Number(loading.id);
    this.state.operationalState = loading.state;
    this.state.emergency = loading.state === "EMERGENCIA";
    this.state.running = ["CARREGANDO", "FINALIZANDO"].includes(loading.state);
    this.state.planned = Number(loading.planned_quantity) || 0;
    this.state.loaded = Number(loading.valid_readings) || 0;
    this.state.detectedBags = Number(loading.detected_bags) || 0;
    this.state.truck = loading.plate || "—";
    this.state.romaneio = loading.romaneio_number || "—";
    this.state.equipmentCode = loading.equipment_code || "—";
    this.state.equipmentId = Number(loading.equipment_id) || null;
    this.state.loadingItems = Array.isArray(loading.items) ? loading.items : [];
    await this.loadPlcCommandStatus(this.state.loadingId);
  }
  applyActiveLoadingSnapshot(loadings, selectedId = this.state.selectedLoadingId) {
    const refresh = this.activeLoadingRefresh
      .catch(() => {})
      .then(() => this._applyActiveLoadingSnapshot(loadings, selectedId));
    this.activeLoadingRefresh = refresh.catch(() => {});
    return refresh;
  }
  _applyActiveLoadingSnapshot(loadings, selectedId = this.state.selectedLoadingId) {
    const activeLoadings = (Array.isArray(loadings) ? loadings : []).filter(
      (item) => item.state !== "FINALIZADO",
    );
    this.state.activeLoadings = activeLoadings;
    const requestedId = Number(selectedId) || null;
    const requestedLoading = activeLoadings.find((item) => Number(item.id) === requestedId);
    const loading = requestedLoading?.equipment_id
      ? requestedLoading
      : (requestedId
        ? null
        : (activeLoadings.length === 1 && activeLoadings[0]?.equipment_id
          ? activeLoadings[0]
          : null));
    if (!loading) {
      this.state.loadingId = null;
      this.state.selectedLoadingId = null;
      this.state.returnMode = false;
      this.state.loaded = 0;
      this.state.detectedBags = 0;
      this.state.planned = 0;
      this.state.running = false;
      this.state.emergency = false;
      this.state.operationalState = "AGUARDANDO";
      this.state.truck = "—";
      this.state.romaneio = "—";
      this.state.equipmentCode = "—";
      this.state.equipmentId = null;
      this.state.plcCommand = null;
      this.state.loadingItems = [];
      return null;
    }
    this.state.loadingId = Number(loading.id);
    this.state.selectedLoadingId = Number(loading.id);
    this.state.operationalState = loading.state;
    this.state.emergency = loading.state === "EMERGENCIA";
    this.state.running = ["CARREGANDO", "FINALIZANDO"].includes(loading.state);
    this.state.planned = Number(loading.planned_quantity) || 0;
    this.state.loaded = Number(loading.valid_readings) || 0;
    this.state.detectedBags = Number(loading.detected_bags) || 0;
    this.state.truck = loading.plate || "—";
    this.state.romaneio = loading.romaneio_number || "—";
    this.state.equipmentCode = loading.equipment_code || "—";
    this.state.equipmentId = Number(loading.equipment_id) || null;
    this.state.loadingItems = Array.isArray(loading.items) ? loading.items : [];
    return loading;
  }
  clpDaDalaAtual() {
    const devices = this.state.monitoring?.dispositivos || [];
    return devices.find(
      (device) =>
        device.device_type === "CLP" &&
        Number(device.equipment_id) === Number(this.state.equipmentId),
    );
  }
  clpDisponivel() {
    const status = String(this.clpDaDalaAtual()?.status || "").toUpperCase();
    return ["ONLINE", "LOCAL", "OK"].includes(status);
  }
  mensagemClpIndisponivel() {
    const device = this.clpDaDalaAtual();
    const seconds = Number(device?.segundos_sem_sinal);
    const time = Number.isFinite(seconds) ? ` há ${seconds} segundos` : "";
    if (!device || device.status === "NAO_REGISTRADO") {
      return "CLP sem status registrado. Novos comandos estão bloqueados até chegar um heartbeat válido.";
    }
    if (device.status === "ERRO") {
      return "O gateway reportou erro na comunicação com o CLP. Novos comandos estão bloqueados.";
    }
    if (device.status === "DESCONHECIDO") {
      return "O status do CLP está desconhecido. Novos comandos estão bloqueados até chegar um heartbeat válido.";
    }
    return `CLP sem comunicação${time}. Novos comandos estão bloqueados; reconectando a cada 2 segundos.`;
  }
  async requestMachineCommand(loadingId, command) {
    if (!loadingId)
      throw new Error("Nenhum carregamento ativo para esta Dala.");
    const response = await this.api.fetch("/api/comando_maquina.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ carregamento_id: loadingId, command }),
    });
    const result = await this.jsonResponse(response, "Não foi possível enviar o comando ao gateway industrial.");
    this.state.plcCommand = {
      id: result.data.command_request_id,
      command: result.data.command,
      status: result.data.status || "PENDENTE",
      response_message: result.data.message || null,
    };
    return result.data;
  }
  async requestMachineOperation(command, loadingId = this.state.loadingId) {
    if (!["INICIAR_CARREGAMENTO", "PAUSAR_CARREGAMENTO"].includes(command))
      throw new Error("Comando operacional inválido.");
    return this.requestMachineCommand(loadingId, command);
  }
  async requestMachineReverse(loadingId, command = "REVERSAO_ATIVAR") {
    if (!["REVERSAO_ATIVAR", "REVERSAO_DESATIVAR"].includes(command))
      throw new Error("Comando de reversão inválido.");
    return this.requestMachineCommand(loadingId, command);
  }
  async requestMachineEmergency(loadingId = this.state.loadingId) {
    const result = await this.requestMachineCommand(loadingId, "EMERGENCIA");
    this.state.operationalState = "EMERGENCIA";
    this.state.emergency = true;
    this.state.running = false;
    this.state.returnMode = false;
    return result;
  }
  async loadPlcCommandStatus(loadingId = this.state.loadingId) {
    const refresh = this.commandStatusRefresh
      .catch(() => {})
      .then(() => this._loadPlcCommandStatus(loadingId));
    this.commandStatusRefresh = refresh.catch(() => {});
    return refresh;
  }
  async _loadPlcCommandStatus(loadingId = this.state.loadingId) {
    if (!loadingId) {
      this.state.plcCommand = null;
      return null;
    }
    const response = await this.api.fetch(
      `/api/comandos_industriais.php?carregamento_id=${encodeURIComponent(loadingId)}`,
    );
    const result = await this.jsonResponse(response, "Não foi possível consultar o comando industrial.");
    const nextCommand = result.data || null;
    const currentCommand = this.state.plcCommand;
    const currentId = Number(currentCommand?.id) || 0;
    const nextId = Number(nextCommand?.id) || 0;
    const terminal = new Set(["APLICADO", "REJEITADO", "ERRO", "EXPIRADO"]);
    const currentStatus = String(currentCommand?.status || "").toUpperCase();
    const nextStatus = String(nextCommand?.status || "").toUpperCase();
    // Uma consulta antiga pode retornar PENDENTE depois de o gateway já ter
    // confirmado o mesmo comando. Nunca regredir o estado visível nesse caso.
    if (
      currentCommand &&
      nextCommand &&
      currentId === nextId &&
      terminal.has(currentStatus) &&
      !terminal.has(nextStatus)
    ) {
      return currentCommand;
    }
    // O endpoint retorna o comando mais recente; não permita que uma resposta
    // de uma consulta anterior substitua um pedido criado depois.
    if (currentCommand && nextCommand && nextId < currentId) {
      return currentCommand;
    }
    this.state.plcCommand = nextCommand;
    return this.state.plcCommand;
  }
  async unlockMachine() {
    if (!this.state.loadingId)
      throw new Error("Nenhum carregamento ativo encontrado.");
    const response = await this.api.fetch("/api/desbloquear_maquina.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ carregamento_id: this.state.loadingId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409) {
        await this.loadActiveLoading();
        if (!this.state.emergency)
          return { alreadyUnlocked: true, state: this.state.operationalState };
      }
      throw new Error(
        result.error || "Não foi possível desbloquear a máquina.",
      );
    }
    await this.loadActiveLoading();
    return result.data;
  }
  async finishLoading(justification = "") {
    if (!this.state.loadingId)
      throw new Error("Nenhum carregamento ativo encontrado.");
    const response = await this.api.fetch("/api/encerrar_carregamento.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ carregamento_id: this.state.loadingId, justification }),
    });
    const result = await this.jsonResponse(response, "Não foi possível finalizar o carregamento.");
    this.state.operationalState = "FINALIZADO";
    this.state.running = false;
    await Promise.all([
      this.loadMonitoring(),
      this.loadEquipments({ force: true }),
    ]);
  }
  async loadPendingReadings() {
    if (!this.state.loadingId) {
      this.state.pendingReadings = [];
      return [];
    }
    const response = await this.api.fetch(`/api/leituras.php?carregamento_id=${encodeURIComponent(this.state.loadingId)}`);
    const result = await this.jsonResponse(response, "Não foi possível carregar leituras pendentes.");
    this.state.pendingReadings = result.data || [];
    return this.state.pendingReadings;
  }
  async registerManualReading(barcode) {
    const loadingId = Number(this.state.loadingId) || 0;
    const code = String(barcode || "").trim();
    if (!loadingId) throw new Error("Nenhum carregamento selecionado.");
    if (!code) throw new Error("Informe o código de barras.");
    const response = await this.api.fetch("/api/leituras.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ carregamento_id: loadingId, barcode: code, attempt_number: 1 }),
    });
    const result = await this.jsonResponse(response, "Não foi possível registrar a leitura manual.");
    await this.loadActiveLoading(loadingId);
    await this.loadPendingReadings();
    return result.data;
  }
  async identifyReading(readingId, barcode) {
    const response = await this.requestWithOfflineQueue("/api/identificar_leitura.php", { method: "POST", headers: this.jsonHeaders(), body: JSON.stringify({ leitura_id: readingId, barcode }) });
    const result = await this.jsonResponse(response, "Não foi possível identificar a leitura.");
    if (result.data?.queued) return result.data;
    await this.loadPendingReadings();
    return result.data;
  }
  async cancelManifest(manifestId, justification = "") {
    const reason = String(justification).trim();
    const response = await this.api.fetch("/api/romaneios.php", {
      method: "PATCH",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        action: "cancel",
        romaneio_id: manifestId,
        justification: reason,
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível cancelar o romaneio.");
    await Promise.all([
      this.loadManifests(),
      this.loadMonitoring(),
      this.loadActiveLoading(null),
      this.loadEquipments({ force: true }),
    ]);
    return result.data;
  }
  async registerReturn(readingId, reason) {
    const response = await this.requestWithOfflineQueue("/api/retornos.php", { method: "POST", headers: this.jsonHeaders(), body: JSON.stringify({ carregamento_id: this.state.loadingId, leitura_id: readingId, reason }) });
    const result = await this.jsonResponse(response, "Não foi possível registrar o retorno.");
    if (result.data?.queued) return result.data;
    await this.loadActiveLoading(this.state.loadingId);
    return result.data;
  }
  async loadMonitoring() {
    const result = await this.sincronizacao.monitoramento();
    this.state.monitoring = result.data;
    this.state.monitoringUpdatedAt = result.updatedAt;
  }
  async loadSyncStatus() {
    this.state.syncStatus = await this.sincronizacao.statusFila();
  }
  async retrySync(id) {
    const result = await this.sincronizacao.reprocessarEvento(id, this.jsonHeaders());
    await this.loadSyncStatus();
    return result;
  }
  async loadProducts() {
    if (this.productsRequest) return this.productsRequest;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    this.productsRequest = this.api.fetch("/api/produtos.php", { signal: controller.signal })
      .then(async (response) => {
        const result = await this.jsonResponse(response, "Não foi possível carregar os produtos.");
        this.state.products = Array.isArray(result.data) ? result.data : [];
        this.state.productsLoaded = true;
        return this.state.products;
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          throw new Error("O carregamento dos produtos demorou. Tente novamente.");
        }
        throw error;
      })
      .finally(() => {
        window.clearTimeout(timeout);
        this.productsRequest = null;
      });
    return this.productsRequest;
  }
  async loadConfiguration() {
    const response = await this.api.fetch("/api/configuracoes.php");
    const result = await this.jsonResponse(response, "Não foi possível carregar a configuração.");
    this.state.configuration = result.data;
  }
  async loadEquipments({ force = false } = {}) {
    if (this.state.equipmentsLoaded && !force) return this.state.equipments;
    if (this.state.equipmentsLoading) return this.state.equipments;
    this.state.equipmentsLoading = true;
    this.state.equipmentsError = "";
    try {
      const response = await this.api.fetch("/api/equipamentos.php");
      const result = await this.jsonResponse(response, "Não foi possível carregar as Dalas.");
      this.state.equipments = Array.isArray(result.data) ? result.data : [];
      return this.state.equipments;
    } catch (error) {
      this.state.equipmentsError =
        error.message || "Não foi possível carregar as Dalas.";
      return this.state.equipments;
    } finally {
      this.state.equipmentsLoaded = true;
      this.state.equipmentsLoading = false;
    }
  }
  async loadCompanies() {
    const query = this.state.userRole === "ADMIN_DALLOGIX" ? "?include_archived=1" : "";
    const response = await this.api.fetch(`/api/empresas.php${query}`);
    const result = await this.jsonResponse(response, "Não foi possível carregar as empresas.");
    this.state.companies = result.data;
  }
  async loadUsers() {
    const companyId = this.state.selectedCompanyId;
    const query = companyId
      ? `?company_id=${encodeURIComponent(companyId)}`
      : "";
    const response = await this.api.fetch(`/api/usuarios.php${query}`);
    if (response.status === 422 && this.state.userRole === "ADMIN_DALLOGIX") {
      this.state.users = [];
      return;
    }
    const result = await this.jsonResponse(response, "Não foi possível carregar os logins.");
    this.state.users = result.data || [];
  }
  async createUser(payload) {
    const requestPayload = { ...(payload || {}) };
    if (
      this.state.userRole === "ADMIN_DALLOGIX" &&
      !requestPayload.company_id &&
      this.state.selectedCompanyId
    ) {
      requestPayload.company_id = this.state.selectedCompanyId;
    }
    const response = await this.api.fetch("/api/usuarios.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(requestPayload),
    });
    const result = await this.jsonResponse(response, "Não foi possível criar o login.");
    return result.data;
  }
  async updateUser(payload) {
    const response = await this.api.fetch("/api/usuarios.php", {
      method: "PUT",
      headers: this.jsonHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await this.jsonResponse(response, "Não foi possível atualizar o login.");
    await this.loadUsers();
    return result.data;
  }
  async createCompany(payload) {
    const response = await this.api.fetch("/api/empresas.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await this.jsonResponse(response, "Não foi possível criar a empresa.");
    this.state.companyActivation = result.data;
    return result.data;
  }
  async generateCompanyActivation(companyId) {
    const response = await this.api.fetch("/api/empresas.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ action: "generate_activation_code", company_id: Number(companyId) }),
    });
    const result = await this.jsonResponse(response, "Não foi possível gerar o código da empresa.");
    this.state.companyActivation = result.data;
    return result.data;
  }
  async renameCompany(id, name) {
    const response = await this.api.fetch("/api/empresas.php", {
      method: "PUT",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ id: Number(id), name: String(name || "").trim() }),
    });
    const result = await this.jsonResponse(response, "Não foi possível renomear a empresa.");
    await this.loadCompanies();
    return result.data;
  }
  async setCompanyArchiveState(id, archived) {
    const response = await this.api.fetch("/api/empresas.php", {
      method: "PUT",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        id: Number(id),
        action: archived ? "archive" : "restore",
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível atualizar o arquivamento da empresa.");
    await this.loadCompanies();
    return result.data;
  }
  async loadLocalActivation() {
    const response = await this.api.fetch("/api/ativacao_local.php", { cache: "no-store" });
    const result = await this.jsonResponse(response, "Não foi possível consultar a ativação local.");
    this.state.localActivation = result.data || { active: false };
    return this.state.localActivation;
  }
  async activateLocalInstallation(payload) {
    const response = await this.api.fetch("/api/ativar_empresa.php", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await this.jsonResponse(response, "Não foi possível ativar esta instalação.");
    this.state.localActivation = result.data || { active: false };
    return this.state.localActivation;
  }
  async deleteCompany(id, { force = false, permanent = false, confirmation = "", password = "" } = {}) {
    const query = new URLSearchParams({ id: String(id) });
    if (force) query.set("force", "1");
    if (permanent) query.set("permanent", "1");
    const response = await this.api.fetch(`/api/empresas.php?${query.toString()}`, {
      method: "DELETE",
      headers: this.jsonHeaders(),
      body: permanent ? JSON.stringify({ confirmation, password }) : undefined,
    });
    const result = await this.jsonResponse(response, "Não foi possível remover a empresa.");
    await this.loadCompanies();
    return result.data;
  }
  async updateLicense(payload) {
    const response = await this.api.fetch("/api/licencas.php", {
      method: "PUT",
      headers: this.jsonHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await this.jsonResponse(response, "Não foi possível atualizar a licença.");
    await this.loadCompanies();
    this.state.companyActivation = null;
    return result.data;
  }
  selectCompany(id) {
    this.state.selectedCompanyId = Number(id);
  }
  async loadCompanyDetail() {
    if (!this.state.selectedCompanyId)
      throw new Error("Nenhuma empresa selecionada.");
    const response = await this.api.fetch(
      `/api/empresas.php?company_id=${this.state.selectedCompanyId}`,
    );
    const result = await this.jsonResponse(response, "Não foi possível carregar a empresa.");
    this.state.companyDetail = result.data;
    await this.loadIndustrialInstallations();
  }
  async loadIndustrialInstallations() {
    if (!this.state.selectedCompanyId)
      throw new Error("Nenhuma empresa selecionada.");
    const response = await this.api.fetch(
      `/api/instalacoes_industriais.php?company_id=${this.state.selectedCompanyId}&include_archived=1`,
      { cache: "no-store" },
    );
    const result = await this.jsonResponse(response, "Não foi possível carregar os PCs industriais.");
    this.state.industrialInstallations = result.data?.installations || [];
    this.state.industrialEquipmentOptions = result.data?.equipment_options || [];
    return result.data;
  }
  async createIndustrialInstallation(name) {
    const response = await this.api.fetch("/api/instalacoes_industriais.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        action: "create",
        company_id: Number(this.state.selectedCompanyId),
        name: String(name || "").trim(),
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível cadastrar o PC industrial.");
    await this.loadIndustrialInstallations();
    return result.data;
  }
  async assignIndustrialEquipment(installationId, equipmentId) {
    const response = await this.api.fetch("/api/instalacoes_industriais.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        action: "assign_equipment",
        installation_id: Number(installationId),
        equipment_id: Number(equipmentId),
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível vincular a Dala ao PC.");
    await this.loadIndustrialInstallations();
    return result.data;
  }
  async revokeIndustrialAccess(installationId) {
    const response = await this.api.fetch("/api/instalacoes_industriais.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        action: "revoke_access",
        installation_id: Number(installationId),
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível revogar o acesso deste PC.");
    this.state.industrialInstallationActivation = null;
    await this.loadIndustrialInstallations();
    return result.data;
  }
  async setIndustrialAccessBlocked(installationId, blocked) {
    const response = await this.api.fetch("/api/instalacoes_industriais.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        action: blocked ? "block_access" : "unblock_access",
        installation_id: Number(installationId),
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível alterar o acesso do PC industrial.");
    this.state.industrialInstallationActivation = null;
    await this.loadIndustrialInstallations();
    return result.data;
  }
  async setIndustrialInstallationArchived(installationId, archived) {
    const response = await this.api.fetch("/api/instalacoes_industriais.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        action: archived ? "archive" : "restore_archive",
        installation_id: Number(installationId),
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível arquivar ou restaurar o PC industrial.");
    this.state.industrialInstallationActivation = null;
    await this.loadIndustrialInstallations();
    return result.data;
  }
  async deleteArchivedIndustrialInstallation(installationId) {
    const response = await this.api.fetch("/api/instalacoes_industriais.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        action: "delete_archived",
        installation_id: Number(installationId),
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível excluir o PC industrial arquivado.");
    this.state.industrialInstallationActivation = null;
    await this.loadIndustrialInstallations();
    return result.data;
  }
  async generateIndustrialActivationCode(installationId) {
    const response = await this.api.fetch("/api/instalacoes_industriais.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        action: "generate_activation_code",
        installation_id: Number(installationId),
      }),
    });
    const result = await this.jsonResponse(response, "Não foi possível gerar o código deste PC.");
    this.state.industrialInstallationActivation = result.data;
    await this.loadIndustrialInstallations();
    return result.data;
  }
  async saveConfiguration(data) {
    const response = await this.api.fetch("/api/configuracoes.php", {
      method: "PUT",
      headers: this.jsonHeaders(),
      body: JSON.stringify(data),
    });
    const result = await this.jsonResponse(response, "Não foi possível salvar a configuração.");
    await this.loadConfiguration();
  }
  async createEquipment(data) {
    const response = await this.api.fetch("/api/equipamentos.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(data),
    });
    const result = await this.jsonResponse(response, "Não foi possível cadastrar a Dala.");
    await this.loadEquipments({ force: true });
    return result.data;
  }
  async createOccurrence(data) {
    const response = await this.api.fetch("/api/ocorrencias.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(data),
    });
    const result = await this.jsonResponse(response, "Não foi possível salvar a ocorrência.");
    await this.loadMonitoring();
  }
  toggleRun() {
    this.state.running = !this.state.running;
    if (this.state.running)
      this.state.loaded = Math.min(this.state.planned, this.state.loaded + 1);
  }
  stop() {
    this.state.running = false;
  }
  toggleReturn() {
    this.state.returnMode = !this.state.returnMode;
  }
  async createProduct(data) {
    const response = await this.api.fetch("/api/produtos.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(data),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        response.status === 401
          ? "Sua sessão expirou. Entre novamente para cadastrar o produto."
          : result.error || "Não foi possível cadastrar o produto.",
      );
      error.status = response.status;
      throw error;
    }
    await this.loadProducts();
  }
  activateEmergency() {
    this.state.emergency = true;
    this.state.operationalState = "EMERGENCIA";
    this.state.running = false;
    this.state.returnMode = false;
  }
}
