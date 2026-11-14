import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Confirmations } from "../confirm.js";
import { formatError, toSourceError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Logger } from "../logger.js";
import type { CrmClient } from "../sources/crm.js";
import type { DocumentIndex } from "../sources/documents.js";
import type { TaskManager } from "../tasks.js";

export interface AppDeps {
  cfg: Config;
  http: HttpClient;
  logger: Logger;
  tasks: TaskManager;
  confirmations: Confirmations;
  docs?: DocumentIndex;
  crm?: CrmClient;
}

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
export const READ_ONLY_LOCAL = { ...READ_ONLY, openWorldHint: false } as const;

export const paginacion = {
  pagina: z.number().int().min(1).max(100).default(1).describe("Página de resultados (empieza en 1)."),
  por_pagina: z.number().int().min(1).max(50).default(10).describe("Resultados por página (1-50)."),
};

export const ventanaTexto = {
  desde_caracter: z.number().int().min(0).default(0).describe("Desde qué carácter leer (usa siguiente_caracter de la respuesta anterior para continuar)."),
  max_caracteres: z.number().int().min(200).max(50_000).default(8000).describe("Máximo de caracteres a devolver."),
};

/** Wraps a tool implementation: JSON result (text + structuredContent) or an actionable error. */
export function handler<A>(logger: Logger, tool: string, fn: (args: A) => Promise<object>) {
  return async (args: A): Promise<CallToolResult> => {
    const t0 = Date.now();
    try {
      const data = await fn(args);
      logger.info("tool ok", { tool, ms: Date.now() - t0 });
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> };
    } catch (err) {
      const se = toSourceError(err);
      logger[se.code === "internal" ? "error" : "warn"]("tool error", { tool, code: se.code, error: se.message, ms: Date.now() - t0, ...(se.code === "internal" && err instanceof Error ? { stack: err.stack } : {}) });
      return { isError: true, content: [{ type: "text", text: formatError(se) }] };
    }
  };
}
