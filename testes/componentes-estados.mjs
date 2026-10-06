import assert from "node:assert/strict";
import test from "node:test";
import { estadoCarregando, estadoErro, estadoVazio } from "../interface/js/componentes/estados.js";

test("estado de carregamento é acessível e escapa a mensagem", () => {
  const html = estadoCarregando("Carregando <Dala>");
  assert.match(html, /role="status"/);
  assert.match(html, /Carregando &lt;Dala&gt;/);
  assert.match(html, /estado-carregando-icone/);
});

test("estado vazio expõe ação segura de recuperação", () => {
  const html = estadoVazio("Nenhuma Dala", "Cadastre uma Dala.", { label: "Abrir", acao: "goto-dalas" });
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Nenhuma Dala/);
  assert.match(html, /data-action="goto-dalas"/);
  assert.doesNotMatch(html, /<script/i);
});

test("estado de erro usa alerta e não injeta mensagem", () => {
  const html = estadoErro("Falha", "<script>alert(1)</script>", { label: "Tentar", acao: "reload-page" });
  assert.match(html, /role="alert"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});
