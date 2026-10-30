import { esc } from "../funcoes/html.js";
import { produtosDisponiveisParaRomaneio } from "../funcoes/romaneio.js?v=202610190001";
import { renderStatusDala } from "../funcoes/status-dala.js?v=202610160004";

export function operationStructureSignature(state, clpAvailable) {
  const pending = (state.pendingReadings || []).map((reading) => reading.id).join(",");
  const unselectedLoadings = state.selectedLoadingId
    ? []
    : (state.activeLoadings || []).map((loading) => [
        loading.id,
        loading.equipment_id,
        loading.state,
        loading.detected_bags,
      ]);
  const loadingItems = (state.loadingItems || []).map((item) => [
    item.product_id,
    item.loaded_quantity,
    item.planned_quantity,
  ]);
  const command = state.plcCommand;
  const intent = state.commandIntent;
  return JSON.stringify([
    state.selectedLoadingId || null,
    state.loadingId || null,
    (state.activeLoadings || []).length,
    unselectedLoadings,
    state.emergency,
    state.operationalState,
    state.running,
    state.reversalCommand,
    state.returnMode,
    state.equipmentCode,
    state.stopReason || null,
    state.operatorAlert || "",
    state.truck,
    state.romaneio,
    state.userRole,
    pending,
    command?.id || null,
    command?.command || null,
    command?.status || null,
    command?.response_message || null,
    intent?.id || null,
    intent?.loadingId || null,
    intent?.command || null,
    intent?.status || null,
    state.commandInFlight === true,
    state.commandFeedback || "",
    clpAvailable === true,
    loadingItems,
  ]);
}

export function linhaItemRomaneio(store, selectedId = "", quantity = 1) {
  const products = store.state.products || [];
  const selectableProducts = produtosDisponiveisParaRomaneio(products, selectedId);
  return `<tr class="manifest-item"><td><select name="item_product"><option value="">Selecionar produto…</option>${selectableProducts.map((product) => `<option value="${product.id}"${String(product.id) === String(selectedId) ? " selected" : ""}>${esc(product.name)}${product.code ? ` (${esc(product.code)})` : ""}${Number(product.active) !== 1 ? " (inativo — selecione um produto ativo)" : ""}</option>`).join("")}</select></td><td><input name="item_quantity" type="number" min="1" value="${Number(quantity) || 1}" /></td><td><button class="button ghost" data-action="remove-item" type="button">Remover</button></td></tr>`;
}

export function renderDalaStatuses(store, error = null) {
  const cells = document.querySelectorAll(".dala-status[data-equipment-id]");
  const byEquipmentId = new Map(
    (store.state.dalaStatuses || []).map((status) => [String(status.equipment_id), status]),
  );
  cells.forEach((cell) => {
    const status = byEquipmentId.get(String(cell.dataset.equipmentId));
    cell.innerHTML = renderStatusDala(status, error?.message || "");
  });
  const viewStatus = document.querySelector("#dala-view-status[data-equipment-id]");
  if (!viewStatus) return;
  const status = (store.state.dalaStatuses || []).find(
    (item) => String(item.equipment_id) === String(viewStatus.dataset.equipmentId),
  );
  if (status) {
    viewStatus.innerHTML = renderStatusDala(status, error?.message || "");
  }
}

const OPERATION_SCANNER_INPUT_SELECTOR = ".manual-operation-reading-form input[name=\"barcode\"], .manual-reading-form input[name=\"barcode\"]";
const PENDING_SCANNER_INPUT_SELECTOR = ".manual-reading-form input[name=\"barcode\"]";
const PRIMARY_SCANNER_INPUT_SELECTOR = ".manual-operation-reading-form input[name=\"barcode\"]";

function operationScannerInput(root, activeElement = globalThis.document?.activeElement) {
  if (
    root?.contains?.(activeElement) &&
    activeElement?.matches?.(PENDING_SCANNER_INPUT_SELECTOR)
  ) return activeElement;
  return root?.querySelector?.(PRIMARY_SCANNER_INPUT_SELECTOR) || null;
}

export function captureOperationScanner(root, activeElement = globalThis.document?.activeElement) {
  if (!root?.contains?.(activeElement) || !activeElement?.matches?.(OPERATION_SCANNER_INPUT_SELECTOR)) return null;
  return {
    value: activeElement.value,
    selectionStart: activeElement.selectionStart,
    selectionEnd: activeElement.selectionEnd,
    selectionDirection: activeElement.selectionDirection,
    readingId: activeElement.closest?.(".manual-reading-form")?.dataset?.readingId || "",
  };
}

export function restoreOperationScanner(root, snapshot) {
  if (!snapshot) return false;
  const pendingInputs = [...(root?.querySelectorAll?.(PENDING_SCANNER_INPUT_SELECTOR) || [])];
  const input = snapshot.readingId
    ? pendingInputs.find((candidate) => candidate.closest?.(".manual-reading-form")?.dataset?.readingId === String(snapshot.readingId))
    : root?.querySelector?.(PRIMARY_SCANNER_INPUT_SELECTOR);
  if (!input || input.disabled) return false;
  input.value = snapshot.value;
  input.focus({ preventScroll: true });
  if (Number.isInteger(snapshot.selectionStart) && Number.isInteger(snapshot.selectionEnd)) {
    input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection || "none");
  }
  return true;
}

export function focusOperationScanner(root, activeElement = globalThis.document?.activeElement) {
  const input = root?.querySelector?.(PRIMARY_SCANNER_INPUT_SELECTOR);
  if (!input || input.disabled) return false;
  const documentRef = globalThis.document;
  if (typeof documentRef?.hasFocus === "function" && !documentRef.hasFocus()) return false;
  if (activeElement !== input) {
    const isEditable = !activeElement?.disabled && activeElement?.matches?.(
      "input, select, textarea, [contenteditable='true']",
    );
    const isDialogControl = Boolean(
      activeElement?.closest?.("[role='dialog'], dialog, [aria-modal='true']"),
    );
    if (isEditable || isDialogControl) return false;
  }
  if (activeElement !== input) input.focus({ preventScroll: true });
  return true;
}

export function updateOperationScannerFocus(root, activeElement = globalThis.document?.activeElement) {
  const status = root?.querySelector?.("[data-scanner-focus]");
  const input = operationScannerInput(root, activeElement);
  if (!status || !input) return false;
  const documentRef = globalThis.document;
  const windowFocused = typeof documentRef?.hasFocus !== "function" || documentRef.hasFocus();
  const pendingInputs = [...(root?.querySelectorAll?.(PENDING_SCANNER_INPUT_SELECTOR) || [])];
  const pendingReadingId = input.closest?.(".manual-reading-form")?.dataset?.readingId || "";
  const ready = !input.disabled && activeElement === input && windowFocused;
  status.textContent = input.disabled
    ? pendingInputs.length
      ? "Há sacas com leitura pendente. Selecione abaixo a saca correspondente antes de ler."
      : "Leitor indisponível enquanto a leitura estiver bloqueada."
    : !windowFocused
      ? "Trace está fora de foco. Volte para esta janela antes de ler."
      : ready
        ? pendingReadingId
          ? `Campo pronto para conferir a leitura #${pendingReadingId}. Leia a mesma saca e confirme o código.`
          : "Leitor pronto. O código será registrado automaticamente ao terminar a leitura."
        : pendingReadingId
          ? `Leitor sem foco. Toque no campo da leitura #${pendingReadingId} antes de ler.`
          : "Leitor sem foco. Toque no campo Código de barras antes de ler.";
  status.classList.toggle("is-error", !ready);
  status.classList.toggle("is-ready", ready);
  return ready;
}

export function instalarRecuperacaoFocoLeitor(root) {
  if (!root?.addEventListener || root.dataset?.scannerFocusRecovery === "installed") return false;
  if (root.dataset) root.dataset.scannerFocusRecovery = "installed";
  const recoverFocus = () => {
    if (!root.isConnected) return;
    if (globalThis.document?.visibilityState === "hidden") {
      updateOperationScannerFocus(root);
      return;
    }
    focusOperationScanner(root, globalThis.document?.activeElement);
    updateOperationScannerFocus(root, globalThis.document?.activeElement);
  };
  root.addEventListener("pointerup", (event) => {
    const target = event.target;
    if (target?.closest?.("input, select, textarea, [contenteditable='true'], [role='dialog'], dialog, [aria-modal='true']")) return;
    globalThis.setTimeout?.(() => {
      if (!root.isConnected) return;
      const activeElement = globalThis.document?.activeElement;
      if (activeElement?.closest?.("[role='dialog'], dialog, [aria-modal='true']")) return;
      recoverFocus();
    }, 0);
  });
  globalThis.window?.addEventListener?.("focus", () => globalThis.setTimeout?.(recoverFocus, 0));
  globalThis.window?.addEventListener?.("blur", () => updateOperationScannerFocus(root));
  globalThis.document?.addEventListener?.("visibilitychange", () => {
    if (globalThis.document?.visibilityState === "visible") {
      globalThis.setTimeout?.(recoverFocus, 0);
    } else {
      updateOperationScannerFocus(root);
    }
  });
  return true;
}

export async function changeOperationLoading(store, render) {
  store.state.commandFeedback = "";
  let changed = true;
  try {
    await store.loadActiveLoading(null);
  } catch (error) {
    changed = false;
    store.state.commandFeedback = error?.message || "Não foi possível atualizar a lista de Dalas.";
  }
  render();
  return changed;
}

export async function atualizarStatusDasDalas(store) {
  try {
    await store.loadDalaStatuses();
    renderDalaStatuses(store);
  } catch (error) {
    renderDalaStatuses(store, error);
  }
}
