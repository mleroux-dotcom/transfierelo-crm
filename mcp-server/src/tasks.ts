import { randomUUID } from "node:crypto";
import { SourceError, toSourceError } from "./errors.js";
import type { Logger } from "./logger.js";

export type TaskState = "en_cola" | "ejecutando" | "completada" | "fallida" | "cancelada";

export interface TaskInfo {
  id: string;
  tipo: string;
  estado: TaskState;
  progreso: number;
  mensaje: string;
  creada_en: string;
  iniciada_en?: string;
  terminada_en?: string;
  resultado?: unknown;
  error?: string;
}

type Work = (progress: (pct: number, msg: string) => void, signal: AbortSignal) => Promise<unknown>;

interface Entry {
  info: TaskInfo;
  work: Work;
  ctrl: AbortController;
}

/**
 * In-process background task queue with bounded concurrency.
 * Finished tasks are kept for `retentionMs` so the agent can collect results later.
 */
export class TaskManager {
  private tasks = new Map<string, Entry>();
  private queue: string[] = [];
  private running = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly logger: Logger,
    private readonly retentionMs = 60 * 60 * 1000,
    private readonly maxStored = 200,
  ) {}

  start(tipo: string, work: Work): TaskInfo {
    this.gc();
    if (this.tasks.size >= this.maxStored) {
      throw new SourceError("rate_limited", "Hay demasiadas tareas guardadas.", "Espera a que terminen o cancela tareas con cancelar_tarea.");
    }
    const id = randomUUID();
    const info: TaskInfo = { id, tipo, estado: "en_cola", progreso: 0, mensaje: "en cola", creada_en: new Date().toISOString() };
    this.tasks.set(id, { info, work, ctrl: new AbortController() });
    this.queue.push(id);
    this.pump();
    return { ...info };
  }

  get(id: string): TaskInfo {
    const e = this.tasks.get(id);
    if (!e) throw new SourceError("not_found", `No existe la tarea ${id} (o expiró tras 1 hora).`, "Inicia una nueva tarea con iniciar_tarea.");
    return { ...e.info };
  }

  list(): TaskInfo[] {
    this.gc();
    return [...this.tasks.values()].map((e) => {
      const { resultado: _r, ...rest } = e.info;
      return rest;
    });
  }

  cancel(id: string): TaskInfo {
    const e = this.tasks.get(id);
    if (!e) throw new SourceError("not_found", `No existe la tarea ${id}.`, "Revisa el id devuelto por iniciar_tarea.");
    if (e.info.estado === "en_cola" || e.info.estado === "ejecutando") {
      e.ctrl.abort();
      this.queue = this.queue.filter((q) => q !== id);
      this.finish(e, "cancelada", { mensaje: "cancelada por el usuario" });
    }
    return { ...e.info };
  }

  /** Resolves when the task leaves the queue/running states (used by tests and graceful shutdown). */
  async wait(id: string, timeoutMs = 30_000): Promise<TaskInfo> {
    const t0 = Date.now();
    for (;;) {
      const info = this.get(id);
      if (!["en_cola", "ejecutando"].includes(info.estado)) return info;
      if (Date.now() - t0 > timeoutMs) return info;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  private pump() {
    while (this.running < this.maxConcurrent && this.queue.length) {
      const id = this.queue.shift()!;
      const e = this.tasks.get(id);
      if (!e || e.info.estado !== "en_cola") continue;
      this.running++;
      e.info.estado = "ejecutando";
      e.info.iniciada_en = new Date().toISOString();
      e.info.mensaje = "iniciada";
      const progress = (pct: number, msg: string) => {
        if (e.info.estado !== "ejecutando") return;
        e.info.progreso = Math.max(0, Math.min(100, Math.round(pct)));
        e.info.mensaje = msg;
      };
      e.work(progress, e.ctrl.signal)
        .then((res) => {
          if (e.info.estado === "ejecutando") this.finish(e, "completada", { resultado: res, progreso: 100, mensaje: "completada" });
        })
        .catch((err) => {
          if (e.info.estado !== "ejecutando") return;
          const se = toSourceError(err);
          this.logger.warn("tarea fallida", { id, tipo: e.info.tipo, error: se.message });
          this.finish(e, "fallida", { error: `${se.message}. Qué hacer: ${se.hint}`, mensaje: "fallida" });
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private finish(e: Entry, estado: TaskState, patch: Partial<TaskInfo>) {
    Object.assign(e.info, patch, { estado, terminada_en: new Date().toISOString() });
  }

  private gc() {
    const now = Date.now();
    for (const [id, e] of this.tasks) {
      if (e.info.terminada_en && now - Date.parse(e.info.terminada_en) > this.retentionMs) this.tasks.delete(id);
    }
  }
}
