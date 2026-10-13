import { esc } from "../funcoes/html.js";
import { produtosDisponiveisParaRomaneio } from "../funcoes/romaneio.js?v=202610020002";

export function linhaItemRomaneio(store, selectedId = "", quantity = 1) {
  const products = store.state.products || [];
  const selectableProducts = produtosDisponiveisParaRomaneio(products, selectedId);
  return `<tr class="manifest-item"><td><select name="item_product"><option value="">Selecionar produto…</option>${selectableProducts.map((product) => `<option value="${product.id}"${String(product.id) === String(selectedId) ? " selected" : ""}>${esc(product.name)}${product.code ? ` (${esc(product.code)})` : ""}${Number(product.active) !== 1 ? " (inativo — selecione um produto ativo)" : ""}</option>`).join("")}</select></td><td><input name="item_quantity" type="number" min="1" value="${Number(quantity) || 1}" /></td><td><button class="button ghost" data-action="remove-item" type="button">Remover</button></td></tr>`;
}

export function renderDalaStatuses(store, error = null) {
  const cells = document.querySelectorAll(".dala-status[data-equipment-id]");
  const statusTone = (value) => {
    if (value === "ONLINE") return "online";
    if (value === "OFFLINE" || value === "ERRO") return "offline";
    return "unknown";
  };
  const byEquipmentId = new Map(
    (store.state.dalaStatuses || []).map((status) => [String(status.equipment_id), status]),
  );
  cells.forEach((cell) => {
    const status = byEquipmentId.get(String(cell.dataset.equipmentId));
    const tone = statusTone(status?.status);
    const message = error?.message || status?.message || "Status indisponível.";
    cell.innerHTML = `<span class="status-dot ${tone}"></span>${esc(message)}`;
  });
  const viewStatus = document.querySelector("#dala-view-status[data-equipment-id]");
  if (!viewStatus) return;
  const status = (store.state.dalaStatuses || []).find(
    (item) => String(item.equipment_id) === String(viewStatus.dataset.equipmentId),
  );
  if (status) {
    const message = error?.message || status.message || status.status;
    viewStatus.innerHTML = `<span class="status-dot ${statusTone(status.status)}"></span>${esc(message)}`;
  }
}

export function captureOperationScanner(root, activeElement = globalThis.document?.activeElement) {
  const selector = ".manual-operation-reading-form input[name=\"barcode\"]";
  if (!root?.contains?.(activeElement) || !activeElement?.matches?.(selector)) return null;
  return {
    value: activeElement.value,
    selectionStart: activeElement.selectionStart,
    selectionEnd: activeElement.selectionEnd,
    selectionDirection: activeElement.selectionDirection,
  };
}

export function restoreOperationScanner(root, snapshot) {
  if (!snapshot) return false;
  const input = root?.querySelector?.(".manual-operation-reading-form input[name=\"barcode\"]");
  if (!input || input.disabled) return false;
  input.value = snapshot.value;
  input.focus({ preventScroll: true });
  if (Number.isInteger(snapshot.selectionStart) && Number.isInteger(snapshot.selectionEnd)) {
    input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection || "none");
  }
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
