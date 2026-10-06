import { exigirRespostaHttp } from "../api/ClienteApi.js?v=202610060006";
import { logFrontend } from "../utilitarios/LogFrontend.js?v=202610060006";

/**
 * Coordena comunicação contínua, fila offline e estado de sincronização.
 * A classe não conhece a tela: recebe um ClienteApi e callbacks pequenos,
 * o que permite testar rede, reconexão e eventos sem abrir o aplicativo.
 */
export class ServicoSincronizacao {
  constructor({ api, offlineBuffer }) {
    if (!api || typeof api.fetch !== "function") {
      throw new TypeError("ClienteApi é obrigatório para sincronizar.");
    }
    if (!offlineBuffer || typeof offlineBuffer.flush !== "function") {
      throw new TypeError("Fila offline é obrigatória para sincronizar.");
    }
    this.api = api;
    this.offlineBuffer = offlineBuffer;
  }

  async monitoramento() {
    const response = await this.api.fetch("/api/monitoramento.php");
    await exigirRespostaHttp(response, "Não foi possível carregar o monitoramento.");
    return { data: (await response.json().catch(() => ({}))).data, updatedAt: new Date().toISOString() };
  }

  async statusFila() {
    const response = await this.api.fetch("/api/sync_status.php");
    const result = await response.json().catch(() => ({}));
    await exigirRespostaHttp(response, result.error || "Não foi possível carregar a fila de sincronização.");
    return result.data;
  }

  async reprocessarEvento(id, headers = {}) {
    const response = await this.api.fetch("/api/sync_queue.php", {
      method: "POST",
      headers,
      body: JSON.stringify({ id }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      await exigirRespostaHttp(response, result.error || "Não foi possível reprocessar o evento.");
    }
    return result.data;
  }

  async enviarPendencias(headers = {}) {
    return this.offlineBuffer.flush(headers);
  }

  assinarEventos({ onData, onError } = {}) {
    if (typeof ReadableStream === "undefined" || typeof TextDecoder === "undefined") return null;
    const controller = new AbortController();
    let fechado = false;
    const escutar = async () => {
      try {
        const response = await this.api.fetch("/api/eventos_carregamento.php?period_days=30", {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
          timeoutMs: 0,
          retry: 0,
        });
        if (!response.ok || !response.body) throw new Error("Conexão de eventos indisponível.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pendente = "";
        let nomeEvento = "";
        let dados = [];
        while (!fechado) {
          const { value, done } = await reader.read();
          if (done) break;
          pendente += decoder.decode(value, { stream: true });
          let quebra;
          while ((quebra = pendente.indexOf("\n")) !== -1) {
            const linha = pendente.slice(0, quebra).replace(/\r$/, "");
            pendente = pendente.slice(quebra + 1);
            if (linha === "") {
              if (nomeEvento === "carregamento" && dados.length) onData?.(JSON.parse(dados.join("\n")));
              nomeEvento = "";
              dados = [];
            } else if (linha.startsWith("event:")) {
              nomeEvento = linha.slice(6).trim();
            } else if (linha.startsWith("data:")) {
              dados.push(linha.slice(5).trimStart());
            }
          }
        }
      } catch (error) {
        if (!fechado) {
          logFrontend.aviso("sincronizacao.eventos", error);
          onError?.(error);
        }
        return;
      }
      if (!fechado) {
        const error = new Error("Conexão de eventos encerrada.");
        logFrontend.aviso("sincronizacao.eventos", error);
        onError?.(error);
      }
    };
    void escutar();
    return { close() { fechado = true; controller.abort(); } };
  }
}
