import assert from "node:assert/strict";
import test from "node:test";
import {
  buscarTodasPaginas,
  validarCursorPaginacao,
} from "../interface/js/funcoes/paginacao-api.js";

test("paginador mantém filtros, encaminha AbortSignal e percorre cursores", async () => {
  const signal = new AbortController().signal;
  const requests = [];
  const pages = [
    { data: [{ id: 4 }], pagination: { has_more: true, next_cursor: "4" } },
    { data: [{ id: 9 }], pagination: { has_more: false, next_cursor: null } },
  ];
  const rows = await buscarTodasPaginas({
    api: { fetch: async (path, options) => {
      requests.push({ path, options });
      return pages.shift();
    } },
    jsonResponse: async (response) => response,
    path: "/api/empresas.php?include_archived=1",
    signal,
  });

  assert.deepEqual(rows, [{ id: 4 }, { id: 9 }]);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0].path, "http://trace.local").searchParams.get("include_archived"), "1");
  assert.equal(new URL(requests[0].path, "http://trace.local").searchParams.get("limit"), "100");
  assert.equal(new URL(requests[0].path, "http://trace.local").searchParams.get("cursor"), "0");
  assert.equal(new URL(requests[1].path, "http://trace.local").searchParams.get("cursor"), "4");
  assert.equal(requests[0].options.signal, signal);
});

test("paginador rejeita resposta sem os campos esperados", async () => {
  await assert.rejects(
    buscarTodasPaginas({
      api: { fetch: async () => ({ data: [] }) },
      jsonResponse: async (response) => response,
      path: "/api/empresas.php",
    }),
    /página sem os dados esperados/,
  );
});

test("paginador recusa cursores repetidos e limita o total em 10.000 registros", async () => {
  assert.throws(
    () => validarCursorPaginacao({ has_more: true, next_cursor: "0" }, 0),
    /cursor de paginação inválido/,
  );

  let requests = 0;
  await assert.rejects(
    buscarTodasPaginas({
      api: { fetch: async () => {
        requests += 1;
        return { data: Array(100).fill({ id: requests }), pagination: { has_more: true, next_cursor: requests } };
      } },
      jsonResponse: async (response) => response,
      path: "/api/empresas.php",
    }),
    /ultrapassa 10.000 registros/,
  );
  assert.equal(requests, 100);
});
