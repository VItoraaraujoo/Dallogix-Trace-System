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
    const intervalo = globalThis.document?.hidden ? 10000 : 2000;
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
    if (eventSource || getPage() !== "work") return;
    const token = ++generation;
    const consume = async (payload) => {
      if (!isCurrent(token)) return;
      reconnectFailures = 0;
      // O stream pode capturar a transição entre a gravação do comando e a
      // atualização da lista de carregamentos. Não descarte a operação local
      // só porque esse quadro veio vazio: confirme pelo endpoint HTTP antes
      // de aceitar o vazio como encerramento real.
      const selectedId = Number(store.state.selectedLoadingId) || null;
      let activeLoadings = Array.isArray(payload?.active_loadings)
        ? payload.active_loadings
        : [];
      const snapshotHasSelection = selectedId === null || activeLoadings.some(
        (loading) => Number(loading?.id) === selectedId,
      );
      if (selectedId && store.state.loadingId && !snapshotHasSelection) {
        try {
          await store.loadActiveLoading(selectedId);
          if (store.state.selectedLoadingId === selectedId) {
            activeLoadings = store.state.activeLoadings || activeLoadings;
          }
        } catch (error) {
          logFrontend.aviso("tempo-real.carregamento", error);
          // Mantém o último quadro confirmado até a próxima tentativa.
          activeLoadings = store.state.activeLoadings || activeLoadings;
        }
      }
      await store.applyActiveLoadingSnapshot(activeLoadings, selectedId);
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
    // O SSE entrega snapshots curtos e pode encerrar logo após o quadro.
    // A consulta periódica permanece ativa mesmo quando o stream conecta,
    // garantindo que comandos e leituras apareçam sem recarregar a tela.
    fallback();
  };
  return { start, stop };
}
