/** Mantém o detalhe da Dala alinhado aos sinais e comandos mais recentes. */
export function createDalaRealtimeController({
  store,
  getPage,
  getEquipmentId,
  render,
  onError = (error) => console.warn("Atualização da Dala indisponível:", error),
  setIntervalFn = (callback, delay) => window.setInterval(callback, delay),
  clearIntervalFn = (timer) => window.clearInterval(timer),
  intervalMs = 15_000,
}) {
  let timer = null;
  let refreshing = false;

  const refresh = async () => {
    if (getPage() !== "dala" || refreshing) return false;
    const equipmentId = Number(getEquipmentId());
    if (!Number.isInteger(equipmentId) || equipmentId <= 0) return false;

    refreshing = true;
    try {
      await Promise.all([
        store.loadEquipment(equipmentId),
        store.loadMonitoring({ requireSuccess: true }),
        store.loadDalaCommandHistory(equipmentId),
      ]);
      if (
        getPage() !== "dala" ||
        Number(getEquipmentId()) !== equipmentId
      ) return false;
      render();
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      refreshing = false;
    }
  };

  const start = () => {
    if (timer !== null || getPage() !== "dala") return;
    timer = setIntervalFn(() => { void refresh(); }, intervalMs);
  };

  const stop = () => {
    if (timer === null) return;
    clearIntervalFn(timer);
    timer = null;
  };

  return { start, stop, refresh };
}
