import { logFrontend } from "../utilitarios/LogFrontend.js?v=202610080002";

const PAGINAS_COM_STATUS_DE_EMPRESA = new Set(["companies", "master-home"]);

/** Atualiza o status das empresas enquanto as telas administrativas permanecem abertas. */
export function createCompanyStatusController({
  store,
  getPage,
  refreshView,
  intervalMs = 15000,
  hiddenIntervalMs = 60000,
}) {
  let timer = null;
  let polling = false;
  let generation = 0;

  const isCurrent = (token) =>
    token === generation && PAGINAS_COM_STATUS_DE_EMPRESA.has(getPage());

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
    let updated = false;
    try {
      await store.loadCompanies();
      updated = true;
    } catch (error) {
      if (isCurrent(token)) logFrontend.aviso("empresas.atualizacao-status", error);
    } finally {
      polling = false;
    }

    if (!isCurrent(token)) return;
    try {
      refreshView({ stale: !updated });
    } catch (error) {
      logFrontend.aviso("empresas.atualizacao-tela", error);
    }
    schedule(token);
  };

  const start = () => {
    if (!PAGINAS_COM_STATUS_DE_EMPRESA.has(getPage()) || timer) return;
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
