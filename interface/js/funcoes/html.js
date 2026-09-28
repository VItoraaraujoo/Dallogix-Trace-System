import { FORM_ACTIONS } from "../constantes/acoes.js";

export const el = (selector) => document.querySelector(selector);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
const safeButtonAttributes = (attributes) => {
  let remaining = String(attributes || "").trim();
  const safe = [];
  while (remaining) {
    const match = remaining.match(
      /^([a-z][a-z0-9-]*)(?:="([^\"]*)")?(?:\s+|$)/i,
    );
    if (!match) break;
    const [, name, value] = match;
    const normalizedName = name.toLowerCase();
    const allowedName =
      normalizedName === "disabled" ||
      normalizedName === "title" ||
      normalizedName.startsWith("data-") ||
      normalizedName.startsWith("aria-");
    const isBoolean = normalizedName === "disabled" && value === undefined;
    if (allowedName && (isBoolean || value !== undefined)) {
      safe.push(
        isBoolean ? normalizedName : `${normalizedName}="${esc(value)}"`,
      );
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  return safe.length ? ` ${safe.join(" ")}` : "";
};

export const button = (label, action, tone = "primary", attributes = "") =>
  `<button class="button ${esc(tone)}" data-action="${esc(action)}" type="${FORM_ACTIONS.has(action) ? "submit" : "button"}"${safeButtonAttributes(attributes)}>${esc(label)}</button>`;
