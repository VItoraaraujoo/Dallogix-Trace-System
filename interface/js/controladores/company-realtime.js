/** Atualiza a situação da empresa sem reiniciar o shell da aplicação. */
export function companyRenameNeedsPause(form, currentName, activeElement) {
  if (!form) return false;
  if (form.dataset?.submitting === "1" || form.contains(activeElement)) return true;
  const nameInput = form.elements?.namedItem?.("name");
  return Boolean(
    nameInput && String(nameInput.value) !== String(currentName ?? ""),
  );
}

export function createCompanyRealtimeController({
  store,
  getPage,
  render,
  shouldPauseRefresh = () => false,
  onError = (error) => console.warn("Atualização da empresa indisponível:", error),
  setIntervalFn = (callback, delay) => window.setInterval(callback, delay),
  clearIntervalFn = (timer) => window.clearInterval(timer),
  intervalMs = 15_000,
}) {
  let timer = null;
  let refreshing = false;

  const refresh = async () => {
    if (getPage() !== "company" || refreshing || shouldPauseRefresh()) return false;
    const companyId = Number(store.state.selectedCompanyId);
    if (!Number.isInteger(companyId) || companyId <= 0) return false;

    refreshing = true;
    try {
      await store.loadCompanyDetail();
      if (
        getPage() !== "company" ||
        Number(store.state.selectedCompanyId) !== companyId ||
        shouldPauseRefresh()
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
    if (timer !== null || getPage() !== "company") return;
    timer = setIntervalFn(() => { void refresh(); }, intervalMs);
  };

  const stop = () => {
    if (timer === null) return;
    clearIntervalFn(timer);
    timer = null;
  };

  return { start, stop, refresh };
}
