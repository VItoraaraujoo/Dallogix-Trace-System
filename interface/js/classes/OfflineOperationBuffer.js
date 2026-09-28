import { agora } from "../funcoes/relogio.js?v=202609170015";

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
    this.owner = null;
  }

  setOwner(user) {
    const companyId = Number(user?.company_id);
    const userId = Number(user?.id);
    this.owner = Number.isSafeInteger(companyId) && companyId > 0 &&
      Number.isSafeInteger(userId) && userId > 0 ? `${companyId}:${userId}` : null;
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
    if (!this.owner) throw new Error("Entre na sua conta para guardar uma operação local.");
    const record = {
      eventId: operation.eventId || (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${agora().getTime().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`),
      owner: this.owner,
      url: operation.url,
      method: operation.method,
      // Credenciais e CSRF da aba não devem permanecer no IndexedDB.
      headers: { "Content-Type": "application/json" },
      body: operation.body || null,
      createdAt: agora().toISOString(),
    };
    try {
      const database = await this.open();
      if (!database) {
        record.id = `${agora().getTime()}-${Math.random().toString(16).slice(2)}`;
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
      record.id = `${agora().getTime()}-${Math.random().toString(16).slice(2)}`;
      this.memory.push(record);
      return record.id;
    }
  }

  async all() {
    if (!this.owner) return [];
    const ownedMemory = this.memory.filter((item) => item.owner === this.owner);
    if (!this.supported()) return ownedMemory;
    try {
      const database = await this.open();
      if (!database) return ownedMemory;
      return await new Promise((resolve, reject) => {
        const request = database.transaction(this.storeName, "readonly").objectStore(this.storeName).getAll();
        request.onsuccess = () => resolve([
          ...ownedMemory,
          ...(request.result || []).filter((item) => item.owner === this.owner),
        ]);
        request.onerror = () => reject(request.error || new Error("Não foi possível ler a fila."));
      });
    } catch (_) {
      return ownedMemory;
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

  async flush(currentHeaders = {}) {
    if (this.flushing || typeof fetch !== "function") return { sent: 0, pending: (await this.all()).length };
    this.flushing = true;
    let sent = 0;
    const owner = this.owner;
    try {
      for (const operation of await this.all()) {
        if (!owner || this.owner !== owner) break;
        try {
          const headers = { ...operation.headers, ...currentHeaders,
            "X-Trace-Offline-Id": String(operation.eventId || operation.id) };
          const response = await fetch(operation.url, {
            method: operation.method,
            headers,
            body: operation.body || undefined,
            credentials: "same-origin",
          });
          if (response.ok) {
            await this.remove(operation.id);
            sent += 1;
          } else {
            // Erros 4xx também precisam ficar visíveis na fila para correção.
            break;
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
