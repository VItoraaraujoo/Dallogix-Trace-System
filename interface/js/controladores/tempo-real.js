import { logFrontend } from "../utilitarios/LogFrontend.js?v=202610060006";

/** Controla a atualização operacional sem acoplar transporte e renderização. */
export function createOperationalRealtimeController({ store, getPage, render, refreshWorkLiveView, workStructureSignature, getViewSignature }) {
  let eventSource = null;
  let fallbackTimer = null;
  let reconnectTimer = null;
  let polling = false;
  let reconnectFailures = 0;
  const stop = () => {
    if (fallbackTimer) window.clearInterval(fallbackTimer);
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    fallbackTimer = null;
    reconnectTimer = null;
    eventSource?.close();
    eventSource = null;
  };
  const fallback = () => {
    if (fallbackTimer) return;
    fallbackTimer = window.setInterval(async () => {
      if (getPage() !== "work") return stop();
      if (polling) return;
      polling = true;
      try {
        await Promise.all([
          store.loadActiveLoading(store.state.selectedLoadingId),
          store.loadMonitoring(),
          store.loadPendingReadings(),
        ]);
        if (workStructureSignature() !== getViewSignature()) render();
        else refreshWorkLiveView();
      } catch (error) {
        logFrontend.aviso("tempo-real.consulta", error);
        /* mantém o último estado visível */
      } finally {
        polling = false;
      }
    }, 5000);
  };
  const start = () => {
    if (eventSource || fallbackTimer || getPage() !== "work") return;
    const consume = async (payload) => {
      reconnectFailures = 0;
      if (payload?.monitoring) {
        store.state.monitoring = payload.monitoring;
        store.state.monitoringUpdatedAt = new Date().toISOString();
      }
      await store.applyActiveLoadingSnapshot(
        payload?.active_loadings || [],
        store.state.selectedLoadingId,
      );
      if (store.state.loadingId) {
        try {
          await Promise.all([
            store.loadPlcCommandStatus(store.state.loadingId),
            store.loadPendingReadings(),
          ]);
        } catch (error) {
          logFrontend.aviso("tempo-real.status", error);
          /* Mantém o último retorno visível se uma consulta falhar. */
        }
      }
      // A navegação pode acontecer enquanto as consultas acima estão em
      // andamento. Nunca deixe uma resposta atrasada renderizar a tela de
      // operação por cima da tela que o usuário já abriu.
      if (getPage() !== "work") return;
      if (workStructureSignature() !== getViewSignature()) render();
      else refreshWorkLiveView();
    };
    const reconnect = () => {
      if (getPage() !== "work" || reconnectTimer) return;
      eventSource?.close();
      eventSource = null;
      reconnectFailures += 1;
      if (reconnectFailures >= 3) {
        fallback();
        return;
      }
      const delay = Math.min(30000, 5000 * (2 ** (reconnectFailures - 1)));
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        start();
      }, delay);
    };
    eventSource = store.subscribeOperationalEvents(consume, reconnect);
    if (!eventSource) fallback();
  };
  return { start, stop };
}
