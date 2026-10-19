/** Coordena consultas e gravações do domínio de romaneios na API local. */
export class ServicoRomaneios {
  constructor({ api, state, jsonHeaders, jsonResponse, getCsrfToken, setManifestRows }) {
    this.api = api;
    this.state = state;
    this.jsonHeaders = jsonHeaders;
    this.jsonResponse = jsonResponse;
    this.getCsrfToken = getCsrfToken;
    this.setManifestRows = setManifestRows;
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
    const rows = result.data || [];
    this.setManifestRows(rows);
    this.state.manifestMeta = result.meta || {
      page,
      per_page: 50,
      total: rows.length,
      pages: rows.length ? 1 : 0,
    };
  }

  async applyFilters(raw) {
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

  async clearFilters() {
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

  async setPage(page) {
    const pages = Math.max(1, Number(this.state.manifestMeta?.pages) || 1);
    this.state.manifestPage = Math.min(pages, Math.max(1, Number(page) || 1));
    await this.loadManifests();
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

  async importPdf(formData) {
    const csrfToken = this.getCsrfToken();
    const response = await this.api.fetch("/api/importar_pdf.php", {
      method: "POST",
      headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
      body: formData,
    });
    const result = await this.jsonResponse(response, "Falha ao importar o PDF.");
    return result.data;
  }
}
