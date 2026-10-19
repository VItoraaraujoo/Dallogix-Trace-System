import { OfflineOperationBuffer, secureRandomId } from "./OfflineOperationBuffer.js?v=20260930-security01";
import { ClienteApi, erroRespostaHttp } from "../api/ClienteApi.js?v=202610140003";
import { ServicoSincronizacao } from "../servicos/ServicoSincronizacao.js?v=202610060007";
import { resolverComandoAtual } from "../funcoes/estado-comando.js?v=202610130003";

const LIMITE_IDADE_MONITORAMENTO_OPERACIONAL_MS = 6000;

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
      stopReason: null,
      operatorAlert: "",
      truck: "—",
      romaneio: "—",
      equipmentCode: "—",
      equipmentId: null,
      // null indica que a Dala ainda não tem reversão confirmada pelo gateway.
      reversalCommand: null,
      monitoring: null,
      monitoringUpdatedAt: null,
      // O status do servidor vem do health check HTTP, não de um heartbeat
      // de dispositivo. Até a primeira resposta, ele permanece desconhecido.
      serverStatus: "DESCONHECIDO",
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
      manifestActionFeedback: null,
      manifestActionPending: false,
      dashboard: null,
      manifestDetail: null,
      equipmentDetail: null,
      companyActivation: null,
      localActivation: null,
      dalaCommands: [],
      dalaCommandsPagination: { page: 1, per_page: 30, total: 0, pages: 1 },
      dalaCommandHistoryEquipmentId: null,
      dalaCommandHistoryRequestedPage: 1,
      dalaActionConfig: { acoes: [], gatilhos: [], can_manage: false },
      errorLogs: [],
      errorLogsPagination: { page: 1, per_page: 100, total: 0, pages: 1 },
      errorLogsRequestedPage: 1,
      errorLogRetentionDays: 365,
      technicalDiagnostics: null,
      deadLetters: [],
      plcCommand: null,
      // Intenção visível enquanto o gateway ainda não confirmou o ACK físico.
      commandIntent: null,
      commandFeedback: "",
      commandInFlight: false,
      commandInFlightToken: null,
      productFormOpen: false,
      dalaFormOpen: false,
      editingProductId: null,
      productSearch: "",
      loadErrors: [],
      pendingReadings: [],
      pendingReadingsPage: 1,
      pendingReadingsPages: 1,
      pendingReadingsTotal: 0,
      pendingReadingsLoadingId: null,
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
    this.pendingReadingsRequestId = 0;
    this.dalaCommandHistoryRequestId = 0;
    this.dalaCommandHistoryPending = null;
    this.errorLogsRequestId = 0;
    this.errorLogsPending = null;
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
    if (!response.ok) {
      // Classifique o erro antes de consumir o corpo. O helper usa clone()
      // para preservar a mensagem enviada pelo servidor, inclusive quando a
      // resposta não contém JSON válido.
      const error = await erroRespostaHttp(response, fallback);
      throw error || new Error(fallback);
    }
    return response.json().catch(() => ({}));
  }
  async fetchAllPages(path, { signal = undefined, cursorParam = "cursor" } = {}) {
    const url = new URL(path, "http://trace.local");
    const rows = [];
    let cursor = 0;
    const pageSize = 100;
    const maxPages = 100;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set(cursorParam, String(cursor));
      const response = await this.api.fetch(`${url.pathname}${url.search}`, { signal });
      const result = await this.jsonResponse(response, "Não foi possível carregar os registros.");
      if (!Array.isArray(result.data) || typeof result.pagination?.has_more !== "boolean") {
        throw new Error("O servidor retornou uma página sem os dados esperados.");
      }
      rows.push(...result.data);
      const nextCursor = this.validarCursorPaginacao(result.pagination, cursor);
      if (nextCursor === null) return rows;
      cursor = nextCursor;
    }

    throw new Error("A lista ultrapassa 10.000 registros; use os filtros para reduzir a consulta.");
  }
  validarCursorPaginacao(pagination, cursorAtual) {
    if (!pagination || typeof pagination.has_more !== "boolean") {
      throw new Error("O servidor retornou metadados de paginação inválidos.");
    }
    if (!pagination.has_more) return null;

    const nextCursor = Number(pagination.next_cursor);
    if (!Number.isSafeInteger(nextCursor) || nextCursor <= cursorAtual) {
      throw new Error("O servidor retornou um cursor de paginação inválido.");
    }
    return nextCursor;
  }
  canQueueOffline(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    return ["POST", "PUT", "PATCH"].includes(method) &&
      ["/api/identificar_leitura.php", "/api/retornos.php", "/api/leituras.php"].some((path) => url.startsWith(path)) &&
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
  beginCommand() {
    if (this.state.commandInFlight) return null;
    const token = secureRandomId();
    this.state.commandInFlight = true;
    this.state.commandInFlightToken = token;
    return token;
  }
  endCommand(token) {
    if (!token || this.state.commandInFlightToken !== token) return false;
    this.state.commandInFlight = false;
    this.state.commandInFlightToken = null;
    return true;
  }
  comandoOperacionalPendente() {
    const current = resolverComandoAtual(this.state.plcCommand, this.state.commandIntent);
    const status = String(current?.status || "").toUpperCase();
    return this.state.commandInFlight || ["PENDENTE", "PROCESSANDO"].includes(status);
  }
  aplicarIntencaoDeComando() {
    const intent = this.state.commandIntent;
    const current = resolverComandoAtual(this.state.plcCommand, intent);
    const status = String(current?.status || "").toUpperCase();
    if (!intent || !["PENDENTE", "PROCESSANDO"].includes(status)) return;
    if (Number(intent.loadingId) !== Number(this.state.loadingId)) return;
    const intentId = Number(intent.id) || null;
    const currentId = Number(current.id) || null;
    if (!intentId || (currentId && currentId !== intentId)) return;
    if (String(current.command || "").toUpperCase() !== String(intent.command || "").toUpperCase()) return;
    if (intent.command === "INICIAR_CARREGAMENTO") {
      this.state.operationalState = "CARREGANDO";
      this.state.running = true;
    } else if (intent.command === "PAUSAR_CARREGAMENTO") {
      this.state.operationalState = "PAUSADO";
      this.state.running = false;
    } else if (intent.command === "REVERSAO_ATIVAR") {
      this.state.returnMode = true;
      this.state.reversalCommand = "REVERSAO_ATIVAR";
    } else if (intent.command === "REVERSAO_DESATIVAR") {
      this.state.returnMode = false;
      this.state.reversalCommand = "REVERSAO_DESATIVAR";
    }
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
    return (await this.jsonResponse(response, "Não foi possível salvar o romaneio.")).data;
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
  async loadDalaCommandHistory(id, page = null) {
    const equipmentKey = String(id);
    const currentPage = this.state.dalaCommandHistoryEquipmentId === equipmentKey
      ? this.state.dalaCommandHistoryRequestedPage || this.state.dalaCommandsPagination?.page || 1
      : 1;
    const normalizedPage = Math.max(1, Number.parseInt(page ?? currentPage, 10) || 1);
    if (this.dalaCommandHistoryPending?.equipmentKey === equipmentKey && this.dalaCommandHistoryPending.page === normalizedPage) {
      return this.dalaCommandHistoryPending.promise;
    }
    const previousEquipmentId = this.state.dalaCommandHistoryEquipmentId;
    const requestId = ++this.dalaCommandHistoryRequestId;
    this.state.dalaCommandHistoryEquipmentId = equipmentKey;
    this.state.dalaCommandHistoryRequestedPage = normalizedPage;
    const promise = Promise.resolve().then(async () => {
      try {
        const response = await this.api.fetch(`/api/comandos_industriais.php?equipment_id=${encodeURIComponent(id)}&page=${normalizedPage}`);
        const result = await this.jsonResponse(response, "Não foi possível carregar o diagnóstico do CLP.");
        if (requestId !== this.dalaCommandHistoryRequestId) return this.state.dalaCommands;
        this.state.dalaCommands = Array.isArray(result.data) ? result.data : [];
        this.state.dalaCommandsPagination = result.pagination || { page: normalizedPage, per_page: 30, total: this.state.dalaCommands.length, pages: 1 };
        this.state.dalaCommandHistoryRequestedPage = this.state.dalaCommandsPagination.page;
        return this.state.dalaCommands;
      } catch (error) {
        if (requestId === this.dalaCommandHistoryRequestId) {
          this.state.dalaCommandHistoryEquipmentId = previousEquipmentId;
          this.state.dalaCommandHistoryRequestedPage = previousEquipmentId === equipmentKey
            ? this.state.dalaCommandsPagination?.page || 1
            : 1;
        }
        throw error;
      } finally {
        if (this.dalaCommandHistoryPending?.requestId === requestId) this.dalaCommandHistoryPending = null;
      }
    });
    this.dalaCommandHistoryPending = { equipmentKey, page: normalizedPage, requestId, promise };
    return promise;
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
  async loadErrorLogs(page = null) {
    const currentPage = page ?? this.state.errorLogsRequestedPage ?? this.state.errorLogsPagination?.page ?? 1;
    const normalizedRequestedPage = Math.max(1, Number.parseInt(currentPage, 10) || 1);
    if (this.errorLogsPending?.page === normalizedRequestedPage) return this.errorLogsPending.promise;
    const requestId = ++this.errorLogsRequestId;
    this.state.errorLogsRequestedPage = normalizedRequestedPage;
    const promise = Promise.resolve().then(async () => {
      try {
        const response = await this.api.fetch(`/api/logs_erros.php?page=${normalizedRequestedPage}`);
        const result = await this.jsonResponse(response, "Não foi possível carregar os logs de erro.");
        if (requestId !== this.errorLogsRequestId) return this.state.errorLogs;
        this.state.errorLogs = result.data || [];
        this.state.errorLogsPagination = result.pagination || { page: normalizedRequestedPage, per_page: 100, total: this.state.errorLogs.length, pages: 1 };
        this.state.errorLogsRequestedPage = this.state.errorLogsPagination.page;
        this.state.errorLogRetentionDays = Number.isInteger(Number(result.retention_days))
          ? Math.max(0, Number(result.retention_days))
          : 365;
        return this.state.errorLogs;
      } catch (error) {
        if (requestId === this.errorLogsRequestId) {
          this.state.errorLogsRequestedPage = this.state.errorLogsPagination?.page || 1;
        }
        throw error;
      } finally {
        if (this.errorLogsPending?.requestId === requestId) this.errorLogsPending = null;
      }
    });
    this.errorLogsPending = { page: normalizedRequestedPage, requestId, promise };
    return promise;
  }
  async persistFrontendLog(record) {
    const response = await this.api.fetch("/api/logs_erros.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(record),
    });
    if (!response.ok) {
      const error = await erroRespostaHttp(response, "Não foi possível persistir o log do navegador.");
      throw error || new Error("Não foi possível persistir o log do navegador.");
    }
    return response;
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
    const loading = this._applyActiveLoadingList(loadings, selectedId);
    if (this.state.loadingId) await this.loadPlcCommandStatus(this.state.loadingId);
    return loading;
  }
  applyActiveLoadingSnapshot(
    loadings,
    selectedId = this.state.selectedLoadingId,
    isCurrent = () => true,
  ) {
    const refresh = this.activeLoadingRefresh
      .catch(() => {})
      .then(() => isCurrent() ? this._applyActiveLoadingSnapshot(loadings, selectedId) : null);
    this.activeLoadingRefresh = refresh.catch(() => {});
    return refresh;
  }
  _applyActiveLoadingSnapshot(loadings, selectedId = this.state.selectedLoadingId) {
    return this._applyActiveLoadingList(loadings, selectedId);
  }
  _applyActiveLoadingList(loadings, selectedId = this.state.selectedLoadingId) {
    const activeLoadings = (Array.isArray(loadings) ? loadings : []).filter(
      (item) => item.state !== "FINALIZADO",
    );
    const requestedId = Number(selectedId) || null;
    const requestedLoading = activeLoadings.find((item) => Number(item.id) === requestedId);
    const preservePendingSelection = Boolean(
      requestedId &&
      Number(this.state.loadingId) === requestedId &&
      !requestedLoading &&
      this.comandoOperacionalPendente(),
    );
    if (!preservePendingSelection) {
      this.state.activeLoadings = activeLoadings;
    }
    const loading = requestedLoading?.equipment_id
      ? requestedLoading
      : (requestedId
        ? null
        : (activeLoadings.length === 1 && activeLoadings[0]?.equipment_id
          ? activeLoadings[0]
          : null));
    if (!loading) {
      if (preservePendingSelection) {
        return this.state.activeLoadings.find(
          (item) => Number(item.id) === requestedId,
        ) || null;
      }
      this.state.loadingId = null;
      this.state.selectedLoadingId = null;
      this.state.returnMode = false;
      this.state.loaded = 0;
      this.state.detectedBags = 0;
      this.state.planned = 0;
      this.state.running = false;
      this.state.emergency = false;
      this.state.operationalState = "AGUARDANDO";
      this.state.stopReason = null;
      this.state.operatorAlert = "";
      this.state.truck = "—";
      this.state.romaneio = "—";
      this.state.equipmentCode = "—";
      this.state.equipmentId = null;
      this.state.reversalCommand = null;
      this.state.plcCommand = null;
      this.state.commandIntent = null;
      this.state.commandFeedback = "";
      this.state.loadingItems = [];
      return null;
    }
    const selectionChanged = Number(this.state.loadingId) !== Number(loading.id);
    if (selectionChanged) {
      this.state.commandFeedback = "";
      this.state.commandIntent = null;
      this.state.plcCommand = null;
    }
    this.state.loadingId = Number(loading.id);
    this.state.selectedLoadingId = Number(loading.id);
    this.state.operationalState = loading.state;
    this.state.stopReason = loading.stop_reason || null;
    this.state.operatorAlert = loading.operator_alert || "";
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
    this.aplicarIntencaoDeComando();
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
  monitoramentoOperacionalAtual() {
    const updatedAt = Date.parse(this.state.monitoringUpdatedAt || "");
    if (!Number.isFinite(updatedAt)) return false;
    const ageMs = Date.now() - updatedAt;
    return ageMs >= -1000 && ageMs <= LIMITE_IDADE_MONITORAMENTO_OPERACIONAL_MS;
  }
  clpDisponivel() {
    if (!this.monitoramentoOperacionalAtual()) return false;
    const status = String(this.clpDaDalaAtual()?.status || "").toUpperCase();
    return status === "ONLINE";
  }
  mensagemClpIndisponivel() {
    if (!this.monitoramentoOperacionalAtual()) {
      return "Sem comunicação recente com o servidor local. Novos comandos estão bloqueados até o status ser atualizado.";
    }
    const device = this.clpDaDalaAtual();
    const status = String(device?.status || "").toUpperCase();
    const rawSeconds = device?.segundos_sem_sinal;
    const seconds = rawSeconds === null || rawSeconds === undefined || rawSeconds === ""
      ? Number.NaN
      : Number(rawSeconds);
    const time = Number.isFinite(seconds) && seconds >= 0
      ? ` há ${seconds === 0 ? "menos de 1 segundo" : `${seconds} segundos`}`
      : "";
    if (!device || status === "NAO_REGISTRADO") {
      return "CLP sem status registrado. Novos comandos estão bloqueados até chegar um heartbeat válido.";
    }
    if (status === "ERRO") {
      return "O gateway reportou erro na comunicação com o CLP. Novos comandos estão bloqueados.";
    }
    if (status === "DESCONHECIDO") {
      return "O status do CLP está desconhecido. Novos comandos estão bloqueados até chegar um heartbeat válido.";
    }
    return `CLP sem comunicação${time}. Novos comandos estão bloqueados; reconectando a cada 2 segundos.`;
  }
  async requestMachineCommand(loadingId, command) {
    if (!loadingId)
      throw new Error("Nenhum carregamento ativo para esta Dala.");
    this.state.commandFeedback = "";
    const response = await this.api.fetch("/api/comando_maquina.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ carregamento_id: loadingId, command }),
    });
    const result = await this.jsonResponse(response, "Não foi possível enviar o comando ao gateway industrial.");
    if (Number(this.state.loadingId) !== Number(loadingId)) return result.data;
    this.state.plcCommand = {
      id: result.data.command_request_id,
      command: result.data.command,
      status: result.data.status || "PENDENTE",
      response_message: result.data.message || null,
    };
    this.state.commandIntent = {
      id: Number(result.data.command_request_id) || null,
      loadingId: Number(loadingId),
      command,
      status: this.state.plcCommand.status,
      previousState: this.state.operationalState,
      previousReturnMode: this.state.returnMode,
      previousReversalCommand: this.state.reversalCommand,
    };
    this.aplicarIntencaoDeComando();
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
    if (Number(this.state.loadingId) !== Number(loadingId)) return result;
    this.state.operationalState = "EMERGENCIA";
    this.state.emergency = true;
    this.state.running = false;
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
      this.state.commandIntent = null;
      return null;
    }
    const response = await this.api.fetch(
      `/api/comandos_industriais.php?carregamento_id=${encodeURIComponent(loadingId)}`,
    );
    const result = await this.jsonResponse(response, "Não foi possível consultar o comando industrial.");
    if (Number(this.state.loadingId) !== Number(loadingId)) return null;
    let confirmedReversalCommand;
    if (Object.hasOwn(result, "reversal_command")) {
      const confirmedCommand = ["REVERSAO_ATIVAR", "REVERSAO_DESATIVAR"].includes(
        result.reversal_command,
      ) ? result.reversal_command : null;
      confirmedReversalCommand = confirmedCommand;
      this.state.reversalCommand = confirmedCommand;
      this.state.returnMode = confirmedCommand === "REVERSAO_ATIVAR";
    }
    const nextCommand = result.data || null;
    const currentCommand = this.state.plcCommand;
    const currentId = Number(currentCommand?.id) || 0;
    const nextId = Number(nextCommand?.id) || 0;
    const terminal = new Set(["APLICADO", "REJEITADO", "ERRO", "EXPIRADO"]);
    const currentStatus = String(currentCommand?.status || "").toUpperCase();
    const nextStatus = String(nextCommand?.status || "").toUpperCase();
    // Logo após registrar uma escrita, o endpoint de consulta pode responder
    // sem o último comando enquanto a fila do gateway ainda é atualizada.
    // Não apague o pedido local nesse intervalo: a tela precisa continuar
    // permitindo a parada que substitui um início ainda pendente.
    if (
      currentCommand &&
      !nextCommand &&
      ["PENDENTE", "PROCESSANDO"].includes(currentStatus)
    ) {
      this.aplicarIntencaoDeComando();
      return currentCommand;
    }
    if (!nextCommand) {
      this.state.plcCommand = null;
      this.state.commandIntent = null;
      this.aplicarIntencaoDeComando();
      return null;
    }
    // Uma consulta antiga pode retornar PENDENTE depois de o gateway já ter
    // confirmado o mesmo comando. Nunca regredir o estado visível nesse caso.
    if (
      currentCommand &&
      nextCommand &&
      currentId === nextId &&
      terminal.has(currentStatus) &&
      !terminal.has(nextStatus)
    ) {
      this.aplicarIntencaoDeComando();
      return currentCommand;
    }
    // O endpoint retorna o comando mais recente; não permita que uma resposta
    // de uma consulta anterior substitua um pedido criado depois.
    if (currentCommand && nextCommand && nextId < currentId) {
      this.aplicarIntencaoDeComando();
      return currentCommand;
    }
    this.state.plcCommand = nextCommand;
    if (nextId > currentId) this.state.commandFeedback = "";
    const intent = this.state.commandIntent;
    const intentId = Number(intent?.id) || 0;
    const sameCommand = intent &&
      String(intent.command || "").toUpperCase() === String(nextCommand.command || "").toUpperCase();
    const matchesIntent = intent && (
      (intentId && nextId && intentId === nextId) ||
      ((!intentId || !nextId) && sameCommand)
    );
    if (intent && nextId && intentId && nextId > intentId) {
      this.state.commandIntent = null;
    } else if (intent && !intentId && !sameCommand) {
      this.state.commandIntent = null;
    } else if (matchesIntent && terminal.has(nextStatus)) {
      this.state.commandFeedback = "";
      if (nextStatus !== "APLICADO" && ["INICIAR_CARREGAMENTO", "PAUSAR_CARREGAMENTO"].includes(intent.command)) {
        this.state.operationalState = intent.previousState || this.state.operationalState;
        this.state.running = ["CARREGANDO", "FINALIZANDO"].includes(this.state.operationalState);
      }
      if (nextStatus !== "APLICADO" && ["REVERSAO_ATIVAR", "REVERSAO_DESATIVAR"].includes(intent.command)) {
        const confirmed = confirmedReversalCommand === undefined
          ? (intent.previousReversalCommand ?? null)
          : confirmedReversalCommand;
        this.state.returnMode = confirmed === "REVERSAO_ATIVAR";
        this.state.reversalCommand = confirmed;
      }
      this.state.commandIntent = null;
    } else if (matchesIntent) {
      intent.status = nextStatus || intent.status;
    }
    this.aplicarIntencaoDeComando();
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
  async loadPendingReadings(page = this.state.pendingReadingsPage) {
    const requestId = ++this.pendingReadingsRequestId;
    if (!this.state.loadingId) {
      this.state.pendingReadings = [];
      this.state.pendingReadingsPage = 1;
      this.state.pendingReadingsPages = 1;
      this.state.pendingReadingsTotal = 0;
      this.state.pendingReadingsLoadingId = null;
      return [];
    }
    const loadingId = Number(this.state.loadingId);
    const requestedPage = this.state.pendingReadingsLoadingId === loadingId ? page : 1;
    const response = await this.api.fetch(`/api/leituras.php?carregamento_id=${encodeURIComponent(loadingId)}&page=${encodeURIComponent(requestedPage)}`);
    const result = await this.jsonResponse(response, "Não foi possível carregar leituras pendentes.");
    if (requestId !== this.pendingReadingsRequestId || Number(this.state.loadingId) !== loadingId) {
      return this.state.pendingReadings;
    }
    this.state.pendingReadings = result.data || [];
    this.state.pendingReadingsPage = Number(result.pagination?.page) || 1;
    this.state.pendingReadingsPages = Number(result.pagination?.pages) || 1;
    this.state.pendingReadingsTotal = Number(result.pagination?.total) || this.state.pendingReadings.length;
    this.state.pendingReadingsLoadingId = loadingId;
    return this.state.pendingReadings;
  }
  async registerManualReading(barcode) {
    const loadingId = Number(this.state.loadingId) || 0;
    const code = String(barcode || "").trim();
    if (!loadingId) throw new Error("Nenhum carregamento selecionado.");
    if (!code) throw new Error("Informe o código de barras.");
    const response = await this.requestWithOfflineQueue("/api/leituras.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ carregamento_id: loadingId, barcode: code, attempt_number: 1 }),
    });
    const result = await this.jsonResponse(response, "Não foi possível registrar a leitura manual.");
    if (result.data?.queued) return result.data;
    let refreshWarning = "";
    try {
      await this.loadActiveLoading(loadingId);
      await this.loadPendingReadings();
    } catch (error) {
      // O POST já foi confirmado pelo servidor. Retornar erro aqui permitiria
      // que o operador repetisse um código que já foi registrado.
      refreshWarning = error?.message || "Falha ao atualizar os dados da operação.";
    }
    return refreshWarning ? { ...result.data, refreshWarning } : result.data;
  }
  async confirmStopRemoval(loadingId = this.state.loadingId) {
    const id = Number(loadingId) || 0;
    if (!id) throw new Error("Nenhum carregamento selecionado.");
    const response = await this.api.fetch("/api/confirmar_remocao.php", {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ carregamento_id: id, confirmar_remocao: true }),
    });
    const result = await this.jsonResponse(response, "Não foi possível registrar a confirmação de segurança.");
    await this.loadActiveLoading(id);
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
    this.productsRequest = this.fetchAllPages("/api/produtos.php", { signal: controller.signal })
      .then((products) => {
        products.sort((left, right) => String(left.name).localeCompare(String(right.name), "pt-BR"));
        this.state.products = products;
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
      this.state.equipments = await this.fetchAllPages("/api/equipamentos.php");
      const hasIndustrialPcData = this.state.equipments.some((equipment) =>
        Object.hasOwn(equipment, "industrial_pc_name"),
      );
      this.state.equipments.sort((left, right) => {
        if (hasIndustrialPcData) {
          const pcOrder = String(left.industrial_pc_name || "").localeCompare(
            String(right.industrial_pc_name || ""),
            "pt-BR",
          );
          if (pcOrder !== 0) return pcOrder;
          const nameOrder = String(left.name || "").localeCompare(String(right.name || ""), "pt-BR");
          if (nameOrder !== 0) return nameOrder;
        }
        return String(left.equipment_code || "").localeCompare(String(right.equipment_code || ""), "pt-BR");
      });
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
    this.state.companies = await this.fetchAllPages(`/api/empresas.php${query}`);
    this.state.companies.sort((left, right) => String(left.name).localeCompare(String(right.name), "pt-BR"));
  }
  async loadUsers() {
    const companyId = this.state.selectedCompanyId;
    const query = companyId
      ? `?company_id=${encodeURIComponent(companyId)}`
      : "";
    try {
      this.state.users = await this.fetchAllPages(`/api/usuarios.php${query}`);
      this.state.users.sort((left, right) => String(left.name).localeCompare(String(right.name), "pt-BR"));
    } catch (error) {
      if (error.status === 422 && this.state.userRole === "ADMIN_DALLOGIX") {
        this.state.users = [];
        return;
      }
      throw error;
    }
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
    const url = new URL("/api/instalacoes_industriais.php", "http://trace.local");
    url.searchParams.set("company_id", String(this.state.selectedCompanyId));
    url.searchParams.set("include_archived", "1");
    const installations = [];
    const equipmentOptions = [];
    let cursor = 0;
    let equipmentCursor = 0;
    let hasMoreInstallations = true;
    let hasMoreEquipment = true;
    const maxPages = 100;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      url.searchParams.set("limit", "100");
      url.searchParams.set("cursor", String(cursor));
      url.searchParams.set("equipment_limit", "100");
      url.searchParams.set("equipment_cursor", String(equipmentCursor));
      const response = await this.api.fetch(`${url.pathname}${url.search}`, { cache: "no-store" });
      const result = await this.jsonResponse(response, "Não foi possível carregar os PCs industriais.");
      const data = result.data || {};
      if (!Array.isArray(data.installations) || !Array.isArray(data.equipment_options)) {
        throw new Error("O servidor retornou uma lista incompleta de PCs industriais.");
      }
      if (hasMoreInstallations) installations.push(...data.installations);
      if (hasMoreEquipment) equipmentOptions.push(...data.equipment_options);
      const installationPage = result.pagination;
      const equipmentPage = result.equipment_pagination;
      const nextInstallationCursor = this.validarCursorPaginacao(installationPage, cursor);
      const nextEquipmentCursor = this.validarCursorPaginacao(equipmentPage, equipmentCursor);
      hasMoreInstallations = nextInstallationCursor !== null;
      hasMoreEquipment = nextEquipmentCursor !== null;
      if (!hasMoreInstallations && !hasMoreEquipment) {
        installations.sort((left, right) => String(left.name).localeCompare(String(right.name), "pt-BR"));
        equipmentOptions.sort((left, right) => String(left.name).localeCompare(String(right.name), "pt-BR"));
        this.state.industrialInstallations = installations;
        this.state.industrialEquipmentOptions = equipmentOptions;
        return { installations, equipment_options: equipmentOptions };
      }
      if (hasMoreInstallations) {
        cursor = nextInstallationCursor;
      } else {
        cursor = Number.MAX_SAFE_INTEGER;
      }
      if (hasMoreEquipment) {
        equipmentCursor = nextEquipmentCursor;
      } else {
        equipmentCursor = Number.MAX_SAFE_INTEGER;
      }
    }
    throw new Error("A lista de PCs industriais ultrapassa 10.000 registros.");
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
  }
}
