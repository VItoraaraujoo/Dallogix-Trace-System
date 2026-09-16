/**
 * Fila pequena e idempotente para gravações operacionais feitas sem rede.
 * IndexedDB é usado quando disponível; o fallback em memória mantém a sessão
 * utilizável em navegadores privados que bloqueiam armazenamento persistente.
 */
export class OfflineOperationBuffer {
  constructor() {
    this.databaseName = "trace-offline-operations";
    this.storeName = "operations";
    this.memory = [];
    this.flushing = false;
  }

  supported() {
    return typeof indexedDB !== "undefined";
  }

  open() {
    if (!this.supported()) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName, { keyPath: "id", autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB indisponível."));
    });
  }

  async enqueue(operation) {
    const record = {
      eventId: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`,
      url: operation.url,
      method: operation.method,
      headers: operation.headers || {},
      body: operation.body || null,
      createdAt: new Date().toISOString(),
    };
    try {
      const database = await this.open();
      if (!database) {
        record.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        this.memory.push(record);
        return record.id;
      }
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(this.storeName, "readwrite");
        const request = transaction.objectStore(this.storeName).add(record);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Não foi possível guardar a operação."));
      });
    } catch (_) {
      record.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      this.memory.push(record);
      return record.id;
    }
  }

  async all() {
    if (!this.supported()) return [...this.memory];
    try {
      const database = await this.open();
      if (!database) return [...this.memory];
      return await new Promise((resolve, reject) => {
        const request = database.transaction(this.storeName, "readonly").objectStore(this.storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error("Não foi possível ler a fila."));
      });
    } catch (_) {
      return [...this.memory];
    }
  }

  async remove(id) {
    this.memory = this.memory.filter((item) => item.id !== id);
    if (!this.supported()) return;
    try {
      const database = await this.open();
      if (!database) return;
      await new Promise((resolve, reject) => {
        const request = database.transaction(this.storeName, "readwrite").objectStore(this.storeName).delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error("Não foi possível remover a operação."));
      });
    } catch (_) {
      /* a operação permanece no armazenamento para a próxima tentativa */
    }
  }

  async flush() {
    if (this.flushing || typeof fetch !== "function") return { sent: 0, pending: (await this.all()).length };
    this.flushing = true;
    let sent = 0;
    try {
      for (const operation of await this.all()) {
        try {
          const headers = { ...(operation.headers || {}), "X-Trace-Offline-Id": String(operation.eventId || operation.id) };
          const response = await fetch(operation.url, {
            method: operation.method,
            headers,
            body: operation.body || undefined,
            credentials: "same-origin",
          });
          if (response.status < 500 && response.status !== 401 && response.status !== 419) {
            await this.remove(operation.id);
            sent += 1;
          }
        } catch (_) {
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
    return { sent, pending: (await this.all()).length };
  }
}
