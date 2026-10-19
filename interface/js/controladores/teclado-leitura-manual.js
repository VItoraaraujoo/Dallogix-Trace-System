/** Alterna entre o teclado virtual e a leitura direta do scanner USB. */
export function alternarTecladoLeituraManual(input, button) {
  if (!input || input.disabled || typeof input.setAttribute !== "function") return false;
  const keyboardEnabled = input.getAttribute("inputmode") !== "text";
  input.blur?.();
  input.setAttribute("inputmode", keyboardEnabled ? "text" : "none");
  if (button) {
    button.textContent = keyboardEnabled ? "Usar leitor" : "Digitar código";
    button.setAttribute?.("aria-pressed", String(keyboardEnabled));
  }
  input.focus?.({ preventScroll: true });
  return keyboardEnabled;
}
