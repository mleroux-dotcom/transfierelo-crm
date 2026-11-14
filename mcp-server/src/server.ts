import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TtlCache } from "./cache.js";
import { sourceStatus, type Config } from "./config.js";
import { Confirmations } from "./confirm.js";
import { HttpClient, type FetchLike, type HttpResult } from "./http.js";
import type { Logger } from "./logger.js";
import { CrmClient } from "./sources/crm.js";
import { DocumentIndex } from "./sources/documents.js";
import { TaskManager } from "./tasks.js";
import { registerCrmTools } from "./tools/crm-tools.js";
import type { AppDeps } from "./tools/helpers.js";
import { registerResearchTools } from "./tools/research-tools.js";
import { registerSourceTools } from "./tools/source-tools.js";

export const SERVER_NAME = "fuentes-mcp";
export const SERVER_VERSION = "1.0.0";

const INSTRUCTIONS = `Servidor de fuentes fidedignas. Política de uso:
1. Ante cualquier pregunta factual, consulta PRIMERO las fuentes (empieza por la tool "investigar") antes de responder con conocimiento propio.
2. Responde solo con lo que digan los resultados y cita cada dato con su url y fecha. Prioriza fiabilidad "alta".
3. Si las fuentes no tienen la respuesta, dilo. Si añades conocimiento general, márcalo como "no verificado".
4. Para cifras de países usa datos_banco_mundial; para papers, buscar_papers/obtener_paper; para documentos internos, buscar_documentos; para clientes y ventas, las tools crm_*.
5. Para investigaciones extensas usa iniciar_tarea (investigacion_profunda) y consultar_tarea.
6. Las escrituras en el CRM (si están habilitadas) requieren confirmación explícita del usuario mediante token_confirmacion.`;

export function buildDeps(cfg: Config, logger: Logger, opts: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}): AppDeps {
  const ua = `${SERVER_NAME}/${SERVER_VERSION} (+https://modelcontextprotocol.io${cfg.CONTACT_EMAIL ? `; mailto:${cfg.CONTACT_EMAIL}` : ""})`;
  const http = new HttpClient({
    fetch: opts.fetch,
    sleep: opts.sleep,
    timeoutMs: cfg.HTTP_TIMEOUT_MS,
    retries: cfg.HTTP_RETRIES,
    cache: new TtlCache<HttpResult>(cfg.CACHE_MAX_ENTRIES, cfg.CACHE_TTL_SECONDS * 1000),
    logger,
    userAgent: ua,
    maxBytes: cfg.MAX_DOWNLOAD_MB * 1e6,
  });
  const status = sourceStatus(cfg);
  const deps: AppDeps = { cfg, http, logger, tasks: new TaskManager(cfg.TASKS_MAX_CONCURRENT, logger), confirmations: new Confirmations() };
  if (status.documentos.activa) deps.docs = new DocumentIndex(cfg.DOCS_DIR!, cfg.DOCS_MAX_FILE_MB * 1e6, logger);
  if (status.crm.activa) deps.crm = new CrmClient(deps);
  return deps;
}

/** Creates an MCP server bound to shared dependencies (cheap; one per HTTP request in stateless mode). */
export function createServer(deps: AppDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS, capabilities: { logging: {} } });
  registerResearchTools(server, deps);
  registerSourceTools(server, deps);
  if (deps.crm) registerCrmTools(server, deps);

  server.registerPrompt(
    "responder_con_fuentes",
    {
      title: "Responder con fuentes verificadas",
      description: "Plantilla que guía al agente a investigar primero y responder solo con datos citados.",
      argsSchema: { pregunta: z.string() },
    },
    ({ pregunta }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Pregunta: ${pregunta}\n\n` +
              "Antes de responder: 1) llama a la tool investigar; 2) lee con las tools obtener_* los 2-4 resultados más relevantes; " +
              "3) responde en español SOLO con información de esas fuentes, citando [título](url) y fecha tras cada afirmación; " +
              "4) termina con una sección 'Fuentes' y otra 'Limitaciones' (fuentes que fallaron, datos no encontrados o contradictorios). " +
              "Si no hay evidencia suficiente, dilo claramente.",
          },
        },
      ],
    }),
  );
  return server;
}
