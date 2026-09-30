import assert from "node:assert/strict";
import { test } from "node:test";
import { button } from "../interface/js/funcoes/html.js";
import { badge, emergencyPanel } from "../interface/js/funcoes/view.js";

test("rótulo desconhecido do badge é texto escapado", () => {
  const html = badge('<img src=x onerror="alert(1)">');
  assert.match(html, /&lt;IMG/);
  assert.match(html, /&quot;/);
  assert.doesNotMatch(html, /<img/i);
  assert.match(badge("FINALIZADO"), /class="badge green">Finalizado<\/span>/);
});

test("botões mantêm atributos legados necessários e bloqueio operacional", () => {
  const html = button("Parar", "stop", "ghost", 'disabled aria-disabled="true" title="Aguarde o CLP" data-loading-id="7"');
  assert.match(html, /disabled aria-disabled="true" title="Aguarde o CLP" data-loading-id="7"/);
  assert.match(html, /data-action="stop" type="button"/);
});

test("atributos externos não inserem eventos, estilos nem substituem ação ou tipo", () => {
  const html = button("Parar", "stop", "ghost", 'onclick="alert(1)" style="display:none" data-action="run" type="submit" formaction="https://example.invalid" data-id="7"');
  assert.doesNotMatch(html, /onclick|style=|formaction|data-action="run"|type="submit"/);
  assert.equal((html.match(/data-action=/g) || []).length, 1);
  assert.match(html, /data-id="7"/);
});

test("atributos estruturados escapam mensagens sem quebrar o bloqueio do botão", () => {
  const html = button("Iniciar", "run", "primary", {
    disabled: true, "aria-disabled": "true", title: 'CLP "sem retorno" <aguarde> & confirme',
    onclick: "alert(1)", "data-action": "emergency",
  });
  assert.match(html, /disabled aria-disabled="true"/);
  assert.match(html, /title="CLP &quot;sem retorno&quot; &lt;aguarde&gt; &amp; confirme"/);
  assert.doesNotMatch(html, /onclick|data-action="emergency"/);
  assert.doesNotMatch(button("Iniciar", "run", "primary", { disabled: false }), / disabled/);
});

test("atributo malformado não injeta HTML e mantém bloqueios anteriores", () => {
  const html = button("Iniciar", "run", "primary", 'disabled title="aguarde"><img src=x onerror="alert(1)">');
  assert.match(html, / disabled>/);
  assert.doesNotMatch(html, /<img|onerror|title=/);
});

test("formulários e painel de emergência preservam tipo e atributos de bloqueio", () => {
  assert.match(button("Salvar", "submit-product"), /type="submit"/);
  const html = emergencyPanel({ canUnlock: true, buttonAttributes: {
    disabled: true, "aria-disabled": "true", title: 'Aguarde "confirmação" do CLP',
  } });
  assert.match(html, /data-action="unlock" type="button" disabled aria-disabled="true"/);
  assert.match(html, /title="Aguarde &quot;confirmação&quot; do CLP"/);
});

test("parser aceita atributos seguros com aspas simples ou valor sem aspas", () => {
  const html = button("Abrir", "view-manifest", "secondary", "data-id=7 aria-label='Abrir romaneio' TITLE=Detalhes");
  assert.match(html, /data-id="7" aria-label="Abrir romaneio" title="Detalhes"/);
});
