function definirFeedback(element, message, tone = "") {
  if (!element) return;
  element.className = `import-feedback${tone ? ` is-${tone}` : ""}`;
  element.textContent = message;
}

function nomeDoArquivo(form) {
  const file = form.querySelector(".file-input");
  const fileName = form.querySelector("[data-file-name]");
  file?.addEventListener("change", () => {
    if (fileName) fileName.textContent = file.files?.[0]?.name || "Nenhum arquivo escolhido";
  });
}

/** Importa um PDF e preenche os campos do formulário manual do romaneio. */
export function bindPdfManifestImportForm({
  form,
  store,
  documentRef = document,
  renderManifestItem,
  formDataFactory = (target) => new FormData(target),
} = {}) {
  if (!form) return false;

  const feedback = documentRef.querySelector("#pdf-import-feedback");
  const showFeedback = (message, tone = "") => definirFeedback(feedback, message, tone);
  nomeDoArquivo(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button.button");
    if (button) button.disabled = true;
    showFeedback("Lendo o PDF…");
    try {
      const data = await store.importPdf(formDataFactory(form));
      const fields = data.fields || {};
      for (const [name, value] of Object.entries({
        number: fields.codigo,
        scheduled_date: fields.data_iso,
        plate: fields.placa,
        expedidor: fields.expedidor,
        driver_name: fields.motorista,
      })) {
        const input = documentRef.querySelector(`#new-manifest-form [name="${name}"]`);
        if (input && value) input.value = value;
      }

      if (data.product && fields.quantidade_numero) {
        const items = documentRef.querySelector("#manifest-items tbody");
        if (items) {
          items.innerHTML = "";
          items.insertAdjacentHTML(
            "beforeend",
            renderManifestItem(store, data.product.id, fields.quantidade_numero),
          );
        }
      }

      const missing = data.missing || [];
      showFeedback(
        `PDF importado.${missing.length ? ` Campos não encontrados: ${missing.join(", ")}.` : " Confira os dados e salve."}`,
        missing.length ? "warning" : "success",
      );
    } catch (error) {
      showFeedback(error.message || "Não foi possível importar o PDF.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  return true;
}

/** Importa um CSV, atualiza a lista de romaneios e apresenta o resultado. */
export function bindCsvManifestImportForm({
  form,
  api,
  store,
  documentRef = document,
  formDataFactory = (target) => new FormData(target),
} = {}) {
  if (!form) return false;

  const feedback = documentRef.querySelector("#csv-import-feedback");
  const showFeedback = (message, tone = "") => definirFeedback(feedback, message, tone);
  nomeDoArquivo(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button.button");
    if (button) button.disabled = true;
    showFeedback("Validando o CSV…");
    try {
      const response = await api.fetch("/api/importar_csv.php", {
        method: "POST",
        headers: store.csrfToken ? { "X-CSRF-Token": store.csrfToken } : {},
        body: formDataFactory(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao importar CSV.");
      await store.loadManifests();
      showFeedback(
        `${result.data.romaneios} romaneio(s), ${result.data.items} item(ns) consolidados em ${result.data.linhas} linha(s) importada(s).`,
        "success",
      );
    } catch (error) {
      showFeedback(error.message || "Falha ao importar CSV.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  return true;
}
