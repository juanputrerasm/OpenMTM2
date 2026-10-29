import { reportError } from "./error-report.js";

export class WorkerClient {
  constructor(url) {
    this.worker = new Worker(url, { type: "module" });
    /** The worker's file, named in its error reports ("sim-worker.js"). */
    this.name = String(url).split(/[/?#]/).filter(Boolean).find((part) => part.endsWith(".js")) ?? String(url);
    this.pending = new Map();
    this.nextId = 1;
    this.failure = null;
    this.ready = false;
    this.listeners = new Map();
    this.worker.addEventListener("message", (e) => this._handleMessage(e.data));

    /*
      A module Worker whose script graph fails to load or throws while evaluating never runs
      its message handler, so every call would sit unresolved and the interface would hang
      with no error anywhere. The error event is the only notice of it, so treat it as fatal
      to the worker and fail everything waiting.
    */
    this.worker.addEventListener("error", (e) => {
      // An error before the worker ever announced itself means the module graph never
      // evaluated. That error carries no message or filename, because the failure belongs to
      // no single script, so say what it actually is and what to do about it.
      if (!this.ready) {
        this._fail(new Error(
          "Worker script failed to load. Its module graph did not evaluate, which is almost "
          + "always a stale cached module: one import that no longer resolves kills the whole "
          + "graph. Reload with caching off (DevTools > Network > Disable cache) or use a "
          + "private window."));
        return;
      }
      // An exception the worker's own code did not catch (in a timer, say): its requests fail, and it is reported, as
      // nothing waiting on a request may be there to see it.
      const where = e.filename ? ` (${e.filename}:${e.lineno})` : "";
      const error = Object.assign(new Error(`Worker failed: ${e.message || "script error"}${where}`), { worker: this.name });
      this._fail(error);
      reportError(error, { where: "background worker" });
    });
    this.worker.addEventListener("messageerror", () => {
      this._fail(new Error("Worker sent a message that could not be deserialised"));
    });
  }

  /**
   * Listen to events the worker posts outside any reply, such as progress:
   * the worker sends `{ event: "progress", payload }`.
   */
  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  call(type, payload, transfer = []) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      // Register before posting: a synchronous failure must still find its deferred.
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, type, payload }, transfer);
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  _fail(error) {
    this.failure = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  terminate() {
    this.worker.terminate();
    // Stopped on purpose (the race left): nothing to report.
    for (const { reject } of this.pending.values()) {
      reject(Object.assign(new Error("Worker terminated."), { expected: true }));
    }
    this.pending.clear();
  }

  _handleMessage(msg) {
    if (msg?.ready) { this.ready = true; return; }
    // A worker's promise rejected with nobody waiting for it (shared/worker-faults.js).
    if (msg?.event === "fault") {
      const p = msg.payload ?? {};
      reportError(Object.assign(new Error(p.message ?? "Worker error"), { name: p.name ?? "Error", worker: this.name, workerStack: p.stack }), { where: "background worker" });
      return;
    }
    if (msg?.event) {
      for (const listener of this.listeners.get(msg.event) ?? []) listener(msg.payload);
      return;
    }
    const deferred = this.pending.get(msg.id);
    if (!deferred) return;
    this.pending.delete(msg.id);
    if (msg.ok) {
      deferred.resolve(msg.payload);
    } else {
      // The worker's stack goes with the error, for the report (shared/error-report.js).
      deferred.reject(Object.assign(new Error(msg.error ?? "Worker error"), {
        worker: this.name, ...(msg.stack ? { workerStack: msg.stack } : {}), ...(msg.name ? { name: msg.name } : {}),
      }));
    }
  }
}
