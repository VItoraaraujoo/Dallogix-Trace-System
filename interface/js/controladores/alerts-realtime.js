/** Mantém o monitoramento e a fila de sincronização atualizados na tela de alertas. */
export function createAlertsRealtimeController({
  store,
  getPage,
  render,
  onError = (error) => console.warn("Atualização do monitoramento indisponível:", error),
  setIntervalFn = (callback, delay) => window.setInterval(callback, delay),
  clearIntervalFn = (timer) => window.clearInterval(timer),
  intervalMs = 15_000,
}) {
  let timer = null;
  let refreshing = false;

  const refresh = async () => {
    if (getPage() !== "alerts" || refreshing) return false;

    refreshing = true;
    try {
      await Promise.all([
        store.loadMonitoring({ requireSuccess: true }),
        store.loadSyncStatus(),
      ]);
      if (getPage() !== "alerts") return false;
      store.state.monitoringRefreshError = false;
      render();
      return true;
    } catch (error) {
      if (getPage() === "alerts") {
        store.state.monitoringRefreshError = true;
        render();
        onError(error);
      }
      return false;
    } finally {
      refreshing = false;
    }
  };

  const start = () => {
    if (timer !== null || getPage() !== "alerts") return;
    timer = setIntervalFn(() => { void refresh(); }, intervalMs);
  };

  const stop = () => {
    if (timer === null) return;
    clearIntervalFn(timer);
    timer = null;
  };

  return { start, stop, refresh };
}
