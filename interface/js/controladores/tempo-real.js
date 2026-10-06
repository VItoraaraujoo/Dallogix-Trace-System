import { logFrontend } from "../utilitarios/LogFrontend.js?v=202610060007";

/** Controla a atualização operacional sem acoplar transporte e renderização. */
export function createOperationalRealtimeController({ store, getPage, render, refreshWorkLiveView, workStructureSignature, getViewSignature }) {
  let eventSource = null;
  let fallbackTimer = null;
  let reconnectTimer = null;
  let polling = false;
  let reconnectFailures = 0;
  let generation = 0;
  const isCurrent = (token) => token === generation && getPage() === "work";
  const stop = () => {
    generation += 1;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    fallbackTimer = null;
    reconnectTimer = null;
    eventSource?.close();
    eventSource = null;
  };
  const fallback = () => {
    if (fallbackTimer) return;
    const token = generation;
    const intervalo = globalThis.document?.hidden ? 15000 : 5000;
    fallbackTimer = window.setTimeout(async () => {
      fallbackTimer = null;
      if (!isCurrent(token)) return;
      if (polling) {
        fallback();
        return;
      }
      polling = true;
      try {
        await Promise.all([
          store.loadActiveLoading(store.state.selectedLoadingId),
          store.loadMonitoring(),
          store.loadPendingReadings(),
        ]);
        if (!isCurrent(token)) return;
        if (workStructureSignature() !== getViewSignature()) render();
        else refreshWorkLiveView();
      } catch (error) {
        logFrontend.aviso("tempo-real.consulta", error);
        /* mantém o último estado visível */
      } finally {
        polling = false;
        if (isCurrent(token)) fallback();
      }
    }, intervalo);
  };
  const start = () => {
    if (eventSource || fallbackTimer || getPage() !== "work") return;
    const token = ++generation;
    const consume = async (payload) => {
      if (!isCurrent(token)) return;
      reconnectFailures = 0;
      await store.applyActiveLoadingSnapshot(
        payload?.active_loadings || [],
        store.state.selectedLoadingId,
      );
      if (!isCurrent(token)) return;
      if (payload?.monitoring) {
        store.state.monitoring = payload.monitoring;
        store.state.monitoringUpdatedAt = new Date().toISOString();
      }
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
      if (!isCurrent(token) || reconnectTimer) return;
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
        if (!isCurrent(token)) return;
        start();
      }, delay);
    };
    eventSource = store.subscribeOperationalEvents(consume, reconnect);
    if (!eventSource) fallback();
  };
  return { start, stop };
}
