import { esc } from "../funcoes/html.js";
import { produtosDisponiveisParaRomaneio } from "../funcoes/romaneio.js?v=202610020002";

export function linhaItemRomaneio(store, selectedId = "", quantity = 1) {
  const products = store.state.products || [];
  const selectableProducts = produtosDisponiveisParaRomaneio(products, selectedId);
  return `<tr class="manifest-item"><td><select name="item_product"><option value="">Selecionar produto…</option>${selectableProducts.map((product) => `<option value="${product.id}"${String(product.id) === String(selectedId) ? " selected" : ""}>${esc(product.name)}${product.code ? ` (${esc(product.code)})` : ""}${Number(product.active) !== 1 ? " (inativo — selecione um produto ativo)" : ""}</option>`).join("")}</select></td><td><input name="item_quantity" type="number" min="1" value="${Number(quantity) || 1}" /></td><td><button class="button ghost" data-action="remove-item" type="button">Remover</button></td></tr>`;
}

export async function atualizarStatusDasDalas(store) {
  const cells = document.querySelectorAll(".dala-status[data-equipment-id]");
  const statusTone = (value) => {
    if (value === "ONLINE") return "online";
    if (value === "OFFLINE" || value === "ERRO") return "offline";
    return "unknown";
  };
  try {
    const statuses = await store.loadDalaStatuses();
    const byEquipmentId = new Map(
      statuses.map((status) => [String(status.equipment_id), status]),
    );
    cells.forEach((cell) => {
      const status = byEquipmentId.get(String(cell.dataset.equipmentId));
      const tone = statusTone(status?.status);
      cell.innerHTML = `<span class="status-dot ${tone}"></span>${esc(status?.message || "Status indisponível.")}`;
    });
  } catch (error) {
    cells.forEach((cell) => {
      cell.innerHTML = `<span class="status-dot unknown"></span>${esc(error.message)}`;
    });
  }
  const viewStatus = document.querySelector("#dala-view-status[data-equipment-id]");
  if (!viewStatus) return;
  const status = store.state.dalaStatuses.find(
    (item) => String(item.equipment_id) === String(viewStatus.dataset.equipmentId),
  );
  if (status) {
    viewStatus.innerHTML = `<span class="status-dot ${statusTone(status.status)}"></span>${esc(status.message || status.status)}`;
  }
}
