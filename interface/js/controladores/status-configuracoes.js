import { logFrontend } from "../utilitarios/LogFrontend.js?v=202610070203";

/** Mantém os indicadores de Configurações sincronizados sem redesenhar os formulários. */
export function createSettingsStatusController({
  store,
  getPage,
  refreshView,
  intervalMs = 5000,
  hiddenIntervalMs = 15000,
}) {
  let timer = null;
  let polling = false;
  let generation = 0;

  const isCurrent = (token) => token === generation && getPage() === "settings";

  const schedule = (token) => {
    if (timer || !isCurrent(token)) return;
    const delay = globalThis.document?.hidden ? hiddenIntervalMs : intervalMs;
    timer = window.setTimeout(() => void poll(token), delay);
  };

  const poll = async (token) => {
    timer = null;
    if (!isCurrent(token)) return;
    if (polling) {
      schedule(token);
      return;
    }

    polling = true;
    const results = await Promise.allSettled([
      store.loadMonitoring(),
      store.loadSyncStatus(),
      store.loadDalaStatuses(),
    ]);
    polling = false;

    if (!isCurrent(token)) return;
    results.forEach((result) => {
      if (result.status === "rejected") {
        logFrontend.aviso("configuracoes.atualizacao-status", result.reason);
      }
    });
    refreshView();
    schedule(token);
  };

  const start = () => {
    if (getPage() !== "settings" || timer) return;
    const token = ++generation;
    schedule(token);
  };

  const stop = () => {
    generation += 1;
    if (timer) window.clearTimeout(timer);
    timer = null;
  };

  return { start, stop };
}
