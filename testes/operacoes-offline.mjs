import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const clientSource = readFileSync(new URL("../interface/js/api/ClienteApi.js", import.meta.url), "utf8");
const clientModuleUrl = `data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`;
const loggerSource = readFileSync(new URL("../interface/js/utilitarios/LogFrontend.js", import.meta.url), "utf8");
const bufferSource = readFileSync(new URL("../interface/js/classes/OfflineOperationBuffer.js", import.meta.url), "utf8")
  .replace(/^import .*relogio\.js[^;]*;\n/, "const agora = () => new Date();\n")
  .replace(/^import .*ClienteApi\.js[^;]*;\n/m, `import { ClienteApi } from ${JSON.stringify(clientModuleUrl)};\n`)
  .replace(/^import .*LogFrontend\.js[^;]*;\n/m, `${loggerSource}\n`);
const bufferModuleUrl = `data:text/javascript;base64,${Buffer.from(bufferSource).toString("base64")}`;
const { OfflineOperationBuffer, secureRandomId } = await import(bufferModuleUrl);
const syncSource = readFileSync(new URL("../interface/js/servicos/ServicoSincronizacao.js", import.meta.url), "utf8")
  .replace(/^import .*ClienteApi\.js[^;]*;\n/m, `import { exigirRespostaHttp } from ${JSON.stringify(clientModuleUrl)};\n`)
  // O serviço é carregado como data: para isolar o armazenamento. Incluir o
  // logger nessa mesma unidade mantém o teste fiel sem depender de uma URL
  // relativa que o Node não consegue resolver a partir de data:.
  .replace(/^import .*LogFrontend\.js[^;]*;\n/m, `${loggerSource}\n`);
const syncModuleUrl = `data:text/javascript;base64,${Buffer.from(syncSource).toString("base64")}`;
const installationsSource = readFileSync(new URL("../interface/js/servicos/ServicoInstalacoesIndustriais.js", import.meta.url), "utf8");
const installationsModuleUrl = `data:text/javascript;base64,${Buffer.from(installationsSource).toString("base64")}`;
const activationServiceSource = readFileSync(new URL("../interface/js/servicos/ServicoAtivacaoLocal.js", import.meta.url), "utf8");
const activationServiceModuleUrl = `data:text/javascript;base64,${Buffer.from(activationServiceSource).toString("base64")}`;
const accountServiceSource = readFileSync(new URL("../interface/js/servicos/ServicoAdministracaoContas.js", import.meta.url), "utf8")
  .replace(/^import .*ServicoAtivacaoLocal\.js[^;]*;\n/m, `import { ServicoAtivacaoLocal } from ${JSON.stringify(activationServiceModuleUrl)};\n`);
const accountServiceModuleUrl = `data:text/javascript;base64,${Buffer.from(accountServiceSource).toString("base64")}`;
const manifestServiceSource = readFileSync(new URL("../interface/js/servicos/ServicoRomaneios.js", import.meta.url), "utf8");
const manifestServiceModuleUrl = `data:text/javascript;base64,${Buffer.from(manifestServiceSource).toString("base64")}`;
const productServiceSource = readFileSync(new URL("../interface/js/servicos/ServicoCatalogoProdutos.js", import.meta.url), "utf8");
const productServiceModuleUrl = `data:text/javascript;base64,${Buffer.from(productServiceSource).toString("base64")}`;
const equipmentServiceSource = readFileSync(new URL("../interface/js/servicos/ServicoDalas.js", import.meta.url), "utf8");
const equipmentServiceModuleUrl = `data:text/javascript;base64,${Buffer.from(equipmentServiceSource).toString("base64")}`;
const observabilitySource = readFileSync(new URL("../interface/js/servicos/ServicoObservabilidade.js", import.meta.url), "utf8")
  .replace(/^import .*ClienteApi\.js[^;]*;\n/m, `import { erroRespostaHttp } from ${JSON.stringify(clientModuleUrl)};\n`);
const observabilityModuleUrl = `data:text/javascript;base64,${Buffer.from(observabilitySource).toString("base64")}`;
const commandStateSource = readFileSync(new URL("../interface/js/funcoes/estado-comando.js", import.meta.url), "utf8");
const commandStateModuleUrl = `data:text/javascript;base64,${Buffer.from(commandStateSource).toString("base64")}`;
const activeLoadingServiceSource = readFileSync(new URL("../interface/js/servicos/ServicoCarregamentoAtivo.js", import.meta.url), "utf8");
const activeLoadingServiceModuleUrl = `data:text/javascript;base64,${Buffer.from(activeLoadingServiceSource).toString("base64")}`;
const machineCommandsServiceSource = readFileSync(new URL("../interface/js/servicos/ServicoComandosMaquina.js", import.meta.url), "utf8");
const machineCommandsServiceModuleUrl = `data:text/javascript;base64,${Buffer.from(machineCommandsServiceSource).toString("base64")}`;
const operationalReadingsServiceSource = readFileSync(new URL("../interface/js/servicos/ServicoLeiturasOperacionais.js", import.meta.url), "utf8");
const operationalReadingsServiceModuleUrl = `data:text/javascript;base64,${Buffer.from(operationalReadingsServiceSource).toString("base64")}`;
const paginationApiSource = readFileSync(new URL("../interface/js/funcoes/paginacao-api.js", import.meta.url), "utf8");
const paginationApiModuleUrl = `data:text/javascript;base64,${Buffer.from(paginationApiSource).toString("base64")}`;
const storeSource = readFileSync(new URL("../interface/js/classes/ArmazenamentoTrace.js", import.meta.url), "utf8")
  .replace(/"\.\/OfflineOperationBuffer\.js\?v=[^"]+"/, JSON.stringify(bufferModuleUrl))
  .replace(/"\.\.\/funcoes\/paginacao-api\.js\?v=[^"]+"/, JSON.stringify(paginationApiModuleUrl))
  .replace(/"\.\.\/api\/ClienteApi\.js\?v=[^"]+"/, JSON.stringify(clientModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoSincronizacao\.js\?v=[^"]+"/, JSON.stringify(syncModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoInstalacoesIndustriais\.js\?v=[^"]+"/, JSON.stringify(installationsModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoAdministracaoContas\.js\?v=[^"]+"/, JSON.stringify(accountServiceModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoRomaneios\.js\?v=[^"]+"/, JSON.stringify(manifestServiceModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoCatalogoProdutos\.js\?v=[^"]+"/, JSON.stringify(productServiceModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoDalas\.js\?v=[^"]+"/, JSON.stringify(equipmentServiceModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoObservabilidade\.js\?v=[^"]+"/, JSON.stringify(observabilityModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoCarregamentoAtivo\.js\?v=[^"]+"/, JSON.stringify(activeLoadingServiceModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoComandosMaquina\.js\?v=[^"]+"/, JSON.stringify(machineCommandsServiceModuleUrl))
  .replace(/"\.\.\/servicos\/ServicoLeiturasOperacionais\.js\?v=[^"]+"/, JSON.stringify(operationalReadingsServiceModuleUrl))
  .replace(/"\.\.\/funcoes\/estado-comando\.js\?v=[^"]+"/, JSON.stringify(commandStateModuleUrl));
const { ArmazenamentoTrace } = await import(`data:text/javascript;base64,${Buffer.from(storeSource).toString("base64")}`);

function criarIndexedDbFakeV2(registros) {
  const indicesConsultados = [];
  const lojas = new Map();
  const nomeLista = (values) => ({ contains: (value) => values.has(value) });
  const criarRequisicao = (result) => {
    const request = { onsuccess: null, onerror: null, result: undefined };
    queueMicrotask(() => {
      request.result = result;
      request.onsuccess?.();
    });
    return request;
  };
  const criarLoja = (name, options = {}) => {
    const store = {
      name,
      keyPath: options.keyPath || "id",
      autoIncrement: Boolean(options.autoIncrement),
      nextId: 1,
      records: new Map(),
      indices: new Map(),
      get indexNames() { return nomeLista(this.indices); },
      createIndex(indexName, keyPath) { this.indices.set(indexName, keyPath); },
      index(indexName) {
        const keyPath = this.indices.get(indexName);
        return {
          getAll(key) {
            indicesConsultados.push(indexName);
            return criarRequisicao([...store.records.values()].filter((record) => record[keyPath] === key));
          },
          count(key) {
            return criarRequisicao([...store.records.values()].filter((record) => record[keyPath] === key).length);
          },
        };
      },
      getAll() { return criarRequisicao([...this.records.values()]); },
      add(record) {
        const id = this.autoIncrement ? this.nextId++ : record[this.keyPath];
        this.records.set(id, { ...record, [this.keyPath]: id });
        return criarRequisicao(id);
      },
    };
    lojas.set(name, store);
    return store;
  };
  criarLoja("operations", { keyPath: "id", autoIncrement: true });
  criarLoja("locks", { keyPath: "owner" });
  for (const record of registros) lojas.get("operations").records.set(record.id, { ...record });

  const database = {
    version: 2,
    get objectStoreNames() { return nomeLista(lojas); },
    createObjectStore: criarLoja,
    transaction() {
      const transaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort() { queueMicrotask(() => this.onabort?.()); },
        objectStore(name) {
          const store = lojas.get(name);
          if (!store) throw new Error(`Object store ausente: ${name}`);
          return {
            indexNames: store.indexNames,
            index: (indexName) => store.index(indexName),
            getAll: (...args) => store.getAll(...args),
            add(record) {
              const request = store.add(record);
              queueMicrotask(() => transaction.oncomplete?.());
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };
  const indexedDb = {
    open(_name, version) {
      const request = {
        result: database,
        transaction: { objectStore: (name) => lojas.get(name) },
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (version > database.version) {
          const oldVersion = database.version;
          database.version = version;
          request.onupgradeneeded?.({ oldVersion, newVersion: version });
        }
        request.onsuccess?.();
      });
      return request;
    },
  };

  return { indexedDb, indicesConsultados, database, lojas };
}

test("a fila pertence ao usuário e não descarta falhas HTTP", async () => {
  const buffer = new OfflineOperationBuffer();
  buffer.setOwner({ id: 1, company_id: 10 });
  const id = await buffer.enqueue({ eventId: "11111111-1111-4111-8111-111111111111", url: "/api/retornos.php", method: "POST", body: "{}", headers: { "X-CSRF-Token": "antigo" } });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => { calls.push(options); return { ok: false, status: 422 }; };
  try {
    assert.equal((await buffer.flush({ "X-CSRF-Token": "atual" })).pending, 1);
    assert.equal(calls[0].headers["X-CSRF-Token"], "atual");
    assert.equal(calls[0].headers["X-Trace-Offline-Id"], "11111111-1111-4111-8111-111111111111");
    buffer.setOwner({ id: 2, company_id: 10 });
    assert.equal((await buffer.all()).length, 0);
    assert.equal((await buffer.flush()).sent, 0);
    buffer.setOwner({ id: 1, company_id: 10 });
    assert.equal((await buffer.all())[0].id, id);
    assert.equal((await buffer.all())[0].headers["X-CSRF-Token"], undefined);
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    assert.deepEqual(await buffer.flush({ "X-CSRF-Token": "atual" }), { sent: 1, pending: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chamadas concorrentes compartilham um único envio da fila offline", async () => {
  const buffer = new OfflineOperationBuffer();
  buffer.setOwner({ id: 1, company_id: 10 });
  await buffer.enqueue({
    eventId: "22222222-2222-4222-8222-222222222222",
    url: "/api/leituras.php",
    method: "POST",
    body: "{}",
  });

  const originalFetch = globalThis.fetch;
  const respostas = [];
  let chamadas = 0;
  let sinalizarInicio;
  const envioIniciado = new Promise((resolve) => { sinalizarInicio = resolve; });
  globalThis.fetch = () => {
    chamadas += 1;
    sinalizarInicio();
    return new Promise((resolve) => {
      respostas.push(resolve);
    });
  };

  try {
    const primeira = buffer.flush();
    const segunda = buffer.flush();
    await envioIniciado;
    await new Promise((resolve) => setImmediate(resolve));
    const totalChamadas = chamadas;
    respostas.forEach((responder) => responder({ ok: true, status: 200 }));
    await Promise.all([primeira, segunda]);

    assert.equal(totalChamadas, 1);
    assert.equal((await buffer.all()).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a migração IndexedDB indexa a fila por usuário e preserva registros existentes", async () => {
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const fake = criarIndexedDbFakeV2([
    { id: 1, owner: "10:1", status: "PENDENTE", url: "/api/leituras.php" },
    { id: 2, owner: "10:2", status: "ERRO", url: "/api/retornos.php" },
  ]);
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fake.indexedDb });
  try {
    const buffer = new OfflineOperationBuffer();
    buffer.setOwner({ id: 1, company_id: 10 });

    const records = await buffer.all();

    assert.equal(fake.database.version, 3);
    assert.deepEqual(records.map((record) => record.id), [1]);
    assert.deepEqual(fake.indicesConsultados, ["by_owner"]);
    assert.equal(fake.lojas.get("operations").records.size, 2);
  } finally {
    if (previousIndexedDb) Object.defineProperty(globalThis, "indexedDB", previousIndexedDb);
    else delete globalThis.indexedDB;
  }
});

test("a fila offline limita cada usuário a 20 registros sem apagar pendências", async () => {
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const registros = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    owner: "10:1",
    status: "PENDENTE",
    url: "/api/leituras.php",
  })).concat(Array.from({ length: 5 }, (_, index) => ({
    id: index + 21,
    owner: "10:2",
    status: "PENDENTE",
    url: "/api/leituras.php",
  })));
  const fake = criarIndexedDbFakeV2(registros);
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fake.indexedDb });
  const buffer = new OfflineOperationBuffer();
  buffer.setOwner({ id: 1, company_id: 10 });
  try {
    await assert.rejects(
      buffer.enqueue({ url: "/api/retornos.php", method: "POST", body: "{}" }),
      (error) => error.code === "OFFLINE_QUEUE_LIMIT" && error.message.includes("20 operações"),
    );

    assert.equal((await buffer.all()).length, 20);
    assert.equal(fake.lojas.get("operations").records.size, 25);
  } finally {
    if (previousIndexedDb) Object.defineProperty(globalThis, "indexedDB", previousIndexedDb);
    else delete globalThis.indexedDB;
  }
});

test("o fallback volátil limita a fila e mantém os registros existentes", async () => {
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  delete globalThis.indexedDB;
  const buffer = new OfflineOperationBuffer();
  buffer.setOwner({ id: 1, company_id: 10 });
  try {
    for (let index = 0; index < 20; index += 1) {
      await buffer.enqueue({ url: "/api/leituras.php", method: "POST", body: "{}" });
    }

    await assert.rejects(
      buffer.enqueue({ url: "/api/retornos.php", method: "POST", body: "{}" }),
      (error) => error.code === "OFFLINE_QUEUE_LIMIT",
    );
    assert.equal((await buffer.all()).length, 20);
  } finally {
    if (previousIndexedDb) Object.defineProperty(globalThis, "indexedDB", previousIndexedDb);
    else delete globalThis.indexedDB;
  }
});

test("falha de IndexedDB é registrada e a operação continua disponível em memória", async () => {
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const erroPersistencia = new Error("IndexedDB bloqueado");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    open() {
      const request = { error: erroPersistencia, onerror: null };
      queueMicrotask(() => request.onerror?.());
      return request;
    },
  } });
  const avisos = [];
  const buffer = new OfflineOperationBuffer({ logger: { aviso: (...args) => avisos.push(args) } });
  buffer.setOwner({ id: 1, company_id: 10 });
  try {
    const id = await buffer.enqueue({
      url: "/api/retornos.php",
      method: "POST",
      body: JSON.stringify({ codigo: "nao deve aparecer no log" }),
    });

    assert.equal((await buffer.all()).length, 1);
    assert.equal(buffer.memory[0].id, id);
    assert.equal(avisos.length, 2);
    assert.deepEqual(avisos.map(([contexto]) => contexto), ["fila-offline.gravar", "fila-offline.ler"]);
    assert.equal(JSON.stringify(avisos).includes("nao deve aparecer no log"), false);
    assert.equal(JSON.stringify(avisos).includes("IndexedDB"), true);
  } finally {
    if (previousIndexedDb) Object.defineProperty(globalThis, "indexedDB", previousIndexedDb);
    else delete globalThis.indexedDB;
  }
});

test("aborto depois do sucesso do pedido aciona o fallback sem afirmar gravação", async () => {
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const erroTransacao = new Error("Transação cancelada");
  const database = {
    transaction() {
      const transaction = {
        error: erroTransacao,
        objectStore() {
          return {
            indexNames: { contains: () => false },
            getAll() {
              const request = { onsuccess: null, onerror: null, result: undefined };
              queueMicrotask(() => {
                request.result = [];
                request.onsuccess?.();
              });
              return request;
            },
            add() {
              const request = { onsuccess: null, onerror: null, result: undefined };
              queueMicrotask(() => {
                request.result = 41;
                request.onsuccess?.();
                queueMicrotask(() => transaction.onabort?.());
              });
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    open() {
      const request = { result: database, onsuccess: null, onerror: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } });
  const avisos = [];
  const buffer = new OfflineOperationBuffer({ logger: { aviso: (...args) => avisos.push(args) } });
  buffer.setOwner({ id: 1, company_id: 10 });
  try {
    const id = await buffer.enqueue({ url: "/api/retornos.php", method: "POST", body: "{}" });

    assert.notEqual(id, 41);
    assert.equal(buffer.memory.length, 1);
    assert.equal(buffer.memory[0].id, id);
    assert.equal(avisos[0][0], "fila-offline.gravar");
    assert.equal(avisos[0][1], erroTransacao);
  } finally {
    if (previousIndexedDb) Object.defineProperty(globalThis, "indexedDB", previousIndexedDb);
    else delete globalThis.indexedDB;
  }
});

test("falha ao confirmar remoção mantém a operação na fila em memória", async () => {
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const erroTransacao = new Error("Remoção cancelada");
  const database = {
    transaction() {
      const transaction = {
        error: erroTransacao,
        objectStore() {
          return {
            delete() {
              const request = { onsuccess: null, onerror: null };
              queueMicrotask(() => {
                request.onsuccess?.();
                queueMicrotask(() => transaction.onabort?.());
              });
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    open() {
      const request = { result: database, onsuccess: null, onerror: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } });
  const avisos = [];
  const buffer = new OfflineOperationBuffer({ logger: { aviso: (...args) => avisos.push(args) } });
  buffer.setOwner({ id: 1, company_id: 10 });
  buffer.memory.push({ id: "offline-only", owner: "10:1", status: "PENDENTE" });
  try {
    await buffer.remove("offline-only");

    assert.equal(buffer.memory.length, 1);
    assert.equal(buffer.memory[0].id, "offline-only");
    assert.equal(avisos[0][0], "fila-offline.remover");
    assert.equal(avisos[0][1], erroTransacao);
  } finally {
    if (previousIndexedDb) Object.defineProperty(globalThis, "indexedDB", previousIndexedDb);
    else delete globalThis.indexedDB;
  }
});

test("ausência de IndexedDB avisa uma única vez que a fila será volátil", async () => {
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  delete globalThis.indexedDB;
  const avisos = [];
  const buffer = new OfflineOperationBuffer({ logger: { aviso: (...args) => avisos.push(args) } });
  buffer.setOwner({ id: 1, company_id: 10 });
  try {
    await buffer.enqueue({ url: "/api/leituras.php", method: "POST", body: "{}" });
    await buffer.enqueue({ url: "/api/leituras.php", method: "POST", body: "{}" });

    assert.equal((await buffer.all()).length, 2);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0][0], "fila-offline.armazenamento-volatil");
    assert.deepEqual(avisos[0][2], {
      armazenamento: "memoria",
      fallback: "perda-ao-fechar-a-aba",
    });
  } finally {
    if (previousIndexedDb) Object.defineProperty(globalThis, "indexedDB", previousIndexedDb);
    else delete globalThis.indexedDB;
  }
});

test("uma resposta perdida conserva o mesmo identificador no envio original e no retry", async () => {
  const store = new ArmazenamentoTrace();
  store.setUser({ id: 3, company_id: 7, role: "USUARIO" });
  store.setCsrfToken("atual");
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, options) => { seen.push(options.headers["X-Trace-Offline-Id"]); if (seen.length === 1) throw new Error("resposta perdida"); return { ok: true }; };
  try {
    const response = await store.requestWithOfflineQueue("/api/retornos.php", { method: "POST", headers: store.jsonHeaders(), body: "{}" });
    assert.equal(response.status, 202);
    assert.equal((await store.flushOfflineOperations()).pending, 0);
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("leitura do scanner não entra na fila offline sem vínculo com a saca", async () => {
  const store = new ArmazenamentoTrace();
  store.setUser({ id: 3, company_id: 7, role: "USUARIO" });
  store.setCsrfToken("atual");
  store.state.loadingId = 12;
  let sentId;
  store.api.fetch = async (_url, options) => {
    sentId = options.headers["X-Trace-Offline-Id"];
    throw new Error("servidor indisponível");
  };
  await assert.rejects(store.registerManualReading("7898250782592"), /servidor indisponível/);
  const pending = await store.offlineBuffer.all();
  assert.match(sentId, /^[a-f0-9-]{16,80}$/i);
  assert.equal(pending.length, 0);
  assert.equal(store.state.offlineQueueSize, 0);
});

test("o fallback usa bytes criptográficos quando randomUUID não existe", () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  let calls = 0;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
    getRandomValues(bytes) {
      calls += 1;
      assert.equal(bytes.length, 16);
      return bytes.fill(0xab);
    },
  } });
  try {
    assert.equal(secureRandomId(), "ab".repeat(16));
    assert.equal(calls, 1);
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
    else delete globalThis.crypto;
  }
});

test("sem criptografia, consultas funcionam e gravações offline são bloqueadas antes do envio", async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const originalFetch = globalThis.fetch;
  const calls = [];
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true }; };
  try {
    assert.throws(() => secureRandomId(), /Geração segura de identificadores indisponível/);
    const store = new ArmazenamentoTrace();
    assert.equal((await store.requestWithOfflineQueue("/api/health.php")).ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers?.["X-Trace-Offline-Id"], undefined);
    await assert.rejects(store.requestWithOfflineQueue("/api/retornos.php", {
      method: "POST", body: "{}",
    }), /Geração segura de identificadores indisponível/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
    else delete globalThis.crypto;
  }
});
