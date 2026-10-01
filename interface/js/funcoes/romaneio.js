import { agora } from "./relogio.js?v=202609170015";
import { button, esc } from "./html.js";

const itemRow = (products, selectedId = "", quantity = 1) => `<tr class="manifest-item">
  <td data-label="Produto"><select name="item_product"><option value="">Selecionar produto…</option>${products.map((product) => `<option value="${product.id}"${String(product.id) === String(selectedId) ? " selected" : ""}>${esc(product.name)}${product.code ? ` (${esc(product.code)})` : ""}</option>`).join("")}</select></td>
  <td data-label="Quantidade"><input name="item_quantity" type="number" min="1" value="${Number(quantity) || 1}" /></td>
  <td data-label="Ações">${button("Remover", "remove-item", "ghost")}</td>
</tr>`;

function industrialPcDate() {
  const now = agora();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
