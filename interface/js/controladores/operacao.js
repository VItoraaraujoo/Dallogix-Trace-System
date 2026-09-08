import { esc } from "../funcoes/html.js";

export function linhaItemRomaneio(store, selectedId = "", quantity = 1) {
  const products = store.state.products || [];
  return `<tr class="manifest-item"><td><select name="item_product"><option value="">Selecionar produto…</option>${products.map((product) => `<option value="${product.id}"${String(product.id) === String(selectedId) ? " selected" : ""}>${esc(product.name)}${product.code ? ` (${esc(product.code)})` : ""}</option>`).join("")}</select></td><td><input name="item_quantity" type="number" min="1" value="${Number(quantity) || 1}" /></td><td><button class="button ghost" data-action="remove-item" type="button">Remover</button></td></tr>`;
}

export async function atualizarStatusDasDalas(store) {
  const cells = document.querySelectorAll(".dala-status[data-equipment-id]");
  await Promise.all([...cells].map(async (cell) => {
    try {
      const status = await store.checkEquipmentStatus(cell.dataset.equipmentId);
      const tone = status.status === "ONLINE" ? "online" : "offline";
      cell.innerHTML = `<span class="status-dot ${tone}"></span>${esc(status.message || status.status)}`;
    } catch (error) {
      cell.innerHTML = `<span class="status-dot offline"></span>${esc(error.message)}`;
    }
  }));
  const viewStatus = document.querySelector("#dala-view-status[data-equipment-id]");
  if (!viewStatus) return;
  try {
    const status = await store.checkEquipmentStatus(viewStatus.dataset.equipmentId);
    viewStatus.innerHTML = `<span class="status-dot ${status.status === "ONLINE" ? "online" : "offline"}"></span>${esc(status.message || status.status)}`;
  } catch (_) { /* a tela mantém o estado anterior */ }
}
