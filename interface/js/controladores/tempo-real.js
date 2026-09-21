/** Controla a atualização operacional sem acoplar transporte e renderização. */
export function createOperationalRealtimeController({ store, getPage, render, refreshWorkLiveView, workStructureSignature, getViewSignature }) {
  let eventSource = null;
  let fallbackTimer = null;
  let reconnectTimer = null;
  let polling = false;
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
        await Promise.all([store.loadActiveLoading(store.state.selectedLoadingId), store.loadMonitoring()]);
        if (workStructureSignature() !== getViewSignature()) render();
        else refreshWorkLiveView();
      } catch (_) {
        /* mantém o último estado visível */
      } finally {
        polling = false;
      }
    }, 1000);
  };
  const start = () => {
    if (eventSource || fallbackTimer || getPage() !== "work") return;
    const consume = (payload) => {
      store.state.monitoring = payload?.monitoring || store.state.monitoring;
      store.applyActiveLoadingSnapshot(payload?.active_loadings || [], store.state.selectedLoadingId);
      if (workStructureSignature() !== getViewSignature()) render();
      else refreshWorkLiveView();
    };
    const reconnect = () => {
      if (getPage() !== "work" || reconnectTimer) return;
      eventSource?.close();
      eventSource = null;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        start();
      }, 5000);
    };
    eventSource = store.subscribeOperationalEvents(consume, reconnect);
    if (!eventSource) fallback();
  };
  return { start, stop };
}
