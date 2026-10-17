import assert from "node:assert/strict";
import test from "node:test";
import { ArmazenamentoTrace } from "../interface/js/classes/ArmazenamentoTrace.js";

test("atualização periódica preserva a página do histórico da Dala", async () => {
  const store = new ArmazenamentoTrace();
  const requests = [];
  store.api.fetch = async (url) => {
    requests.push(url);
    return {
      ok: true,
      json: async () => ({
        data: [{ id: 31 }],
        pagination: { page: 2, per_page: 30, total: 61, pages: 3 },
      }),
    };
  };

  await store.loadDalaCommandHistory(7, 2);
  await store.loadDalaCommandHistory(7);
  assert.match(requests[0], /equipment_id=7&page=2/);
  assert.match(requests[1], /equipment_id=7&page=2/);
});

test("consulta automática em voo reutiliza a navegação para outra página da Dala", async () => {
  const store = new ArmazenamentoTrace();
  const pending = [];
  store.api.fetch = (url) => new Promise((resolve) => pending.push({ url, resolve }));
  const response = (page) => ({
    ok: true,
    json: async () => ({ data: [{ id: page }], pagination: { page, per_page: 30, total: 61, pages: 3 } }),
  });

  const navigation = store.loadDalaCommandHistory(7, 2);
  const refresh = store.loadDalaCommandHistory(7);
  await Promise.resolve();
  assert.equal(pending.length, 1);
  assert.match(pending[0].url, /page=2/);
  pending[0].resolve(response(2));
  await Promise.all([navigation, refresh]);

  assert.equal(store.state.dalaCommandsPagination.page, 2);
  assert.equal(store.state.dalaCommands[0].id, 2);
});

test("atualização periódica preserva a página dos logs e a retenção do servidor", async () => {
  const store = new ArmazenamentoTrace();
  const requests = [];
  store.api.fetch = async (url) => {
    requests.push(url);
    return {
      ok: true,
      json: async () => ({
        data: [{ id: 101 }],
        pagination: { page: 2, per_page: 100, total: 150, pages: 2 },
        retention_days: 365,
      }),
    };
  };

  await store.loadErrorLogs(2);
  await store.loadErrorLogs();
  assert.match(requests[0], /page=2/);
  assert.match(requests[1], /page=2/);
  assert.equal(store.state.errorLogRetentionDays, 365);
});

test("consulta automática em voo reutiliza a navegação para outra página de logs", async () => {
  const store = new ArmazenamentoTrace();
  const pending = [];
  store.api.fetch = (url) => new Promise((resolve) => pending.push({ url, resolve }));
  const response = (page) => ({
    ok: true,
    json: async () => ({
      data: [{ id: page * 100 }],
      pagination: { page, per_page: 100, total: 250, pages: 3 },
      retention_days: 365,
    }),
  });

  const navigation = store.loadErrorLogs(2);
  const refresh = store.loadErrorLogs();
  await Promise.resolve();
  assert.equal(pending.length, 1);
  assert.match(pending[0].url, /page=2/);
  pending[0].resolve(response(2));
  await Promise.all([navigation, refresh]);

  assert.equal(store.state.errorLogsPagination.page, 2);
  assert.equal(store.state.errorLogs[0].id, 200);
});
