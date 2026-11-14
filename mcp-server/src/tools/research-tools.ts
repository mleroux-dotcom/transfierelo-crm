import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sourceStatus } from "../config.js";
import { SourceError } from "../errors.js";
import { EvidenciaSchema } from "../evidence.js";
import { investigacionProfunda, investigar, mapLimit, RESEARCH_SOURCES } from "../research.js";
import { handler, READ_ONLY, READ_ONLY_LOCAL, type AppDeps } from "./helpers.js";

const fuentesParam = z
  .array(z.enum(RESEARCH_SOURCES))
  .min(1)
  .optional()
  .describe("Fuentes a consultar. Por defecto: wikipedia, wikidata, openalex, pubmed, arxiv, github y, si están configuradas, busqueda_web, documentos y crm. Crossref solo si se pide.");

const ResultadoSchema = {
  pregunta: z.string(),
  consultado_en: z.string(),
  resultados: z.array(EvidenciaSchema.extend({ relevancia: z.number() })),
  fuentes: z.array(z.object({ fuente: z.string(), estado: z.enum(["ok", "error", "inactiva"]), resultados: z.number(), ms: z.number().optional(), error: z.string().optional() })),
  cobertura: z.string(),
  instrucciones: z.string(),
};

export function registerResearchTools(server: McpServer, d: AppDeps) {
  server.registerTool(
    "investigar",
    {
      title: "Investigar en todas las fuentes",
      description:
        "PRIMERA tool a usar ante cualquier pregunta factual. Consulta EN PARALELO todas las fuentes fidedignas activas (enciclopedia, datos estructurados, papers, código, web, documentos propios, CRM), " +
        "elimina duplicados (por DOI/URL) y ordena por relevancia y fiabilidad. Cada resultado trae fuente, url, fechas y fiabilidad. " +
        "Usa luego las tools obtener_* para leer el detalle de los mejores resultados. No la uses para datos numéricos de países (usa datos_banco_mundial).",
      inputSchema: {
        pregunta: z.string().min(2).max(500).describe("Pregunta o tema, en lenguaje natural o palabras clave. Para papers funcionan mejor términos en inglés."),
        fuentes: fuentesParam,
        max_por_fuente: z.number().int().min(1).max(20).default(5),
        max_resultados: z.number().int().min(1).max(60).default(25),
      },
      outputSchema: ResultadoSchema,
      annotations: READ_ONLY,
    },
    handler(d.logger, "investigar", (a) => investigar(d, a)),
  );

  server.registerTool(
    "investigar_lote",
    {
      title: "Investigar varias preguntas",
      description: "Igual que investigar, pero para varias preguntas a la vez (máx. 10), ejecutadas en paralelo. Úsala cuando necesites cubrir varios subtemas o comparar entidades.",
      inputSchema: {
        preguntas: z.array(z.string().min(2).max(500)).min(1).max(10),
        fuentes: fuentesParam,
        max_por_fuente: z.number().int().min(1).max(10).default(3),
        max_resultados: z.number().int().min(1).max(30).default(10),
      },
      annotations: READ_ONLY,
    },
    handler(d.logger, "investigar_lote", async (a) => ({
      investigaciones: await mapLimit(a.preguntas, 3, (pregunta) => investigar(d, { pregunta, fuentes: a.fuentes, max_por_fuente: a.max_por_fuente, max_resultados: a.max_resultados })),
    })),
  );

  server.registerTool(
    "listar_fuentes",
    {
      title: "Listar fuentes",
      description: "Muestra qué fuentes están activas, cuáles no y por qué (falta de credenciales, desactivadas). Úsala si una fuente falla o para explicar al usuario de dónde vienen los datos.",
      inputSchema: {},
      annotations: READ_ONLY_LOCAL,
    },
    handler(d.logger, "listar_fuentes", async () => ({
      fuentes: sourceStatus(d.cfg),
      escritura_habilitada: d.cfg.ALLOW_WRITES,
      cache_ttl_segundos: d.cfg.CACHE_TTL_SECONDS,
    })),
  );

  // ---------- background tasks ----------

  server.registerTool(
    "iniciar_tarea",
    {
      title: "Iniciar tarea en segundo plano",
      description:
        "Inicia un trabajo largo y devuelve un tarea_id al instante. Tipos: " +
        "'investigacion_profunda' (busca en todas las fuentes, lee el contenido completo de los mejores resultados y sigue trabajos académicos relacionados; 20-90 s) y " +
        "'indexar_documentos' (re-indexa la carpeta DOCS_DIR completa). Consulta el avance con consultar_tarea.",
      inputSchema: {
        tipo: z.enum(["investigacion_profunda", "indexar_documentos"]),
        pregunta: z.string().min(2).max(500).optional().describe("Obligatoria para investigacion_profunda."),
        fuentes: fuentesParam,
        profundidad: z.number().int().min(1).max(15).default(6).describe("Cuántos resultados leer completos (investigacion_profunda)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handler(d.logger, "iniciar_tarea", async (a) => {
      if (a.tipo === "investigacion_profunda") {
        if (!a.pregunta) throw new SourceError("invalid_input", "Falta 'pregunta'.", "Indica la pregunta a investigar.");
        const t = d.tasks.start(a.tipo, (progress, signal) => investigacionProfunda(d, { pregunta: a.pregunta!, fuentes: a.fuentes, profundidad: a.profundidad }, progress, signal));
        return { tarea: t, siguiente_paso: "Llama a consultar_tarea con este id en unos segundos." };
      }
      if (!d.docs) throw new SourceError("source_disabled", "La fuente de documentos no está activa.", "Define DOCS_DIR con la carpeta de documentos y reinicia el servidor.");
      const docs = d.docs;
      const t = d.tasks.start(a.tipo, (progress) => docs.sync(true, (done, total) => progress((done / Math.max(1, total)) * 100, `${done}/${total} archivos`)));
      return { tarea: t, siguiente_paso: "Llama a consultar_tarea con este id para ver el avance." };
    }),
  );

  server.registerTool(
    "consultar_tarea",
    {
      title: "Consultar tarea",
      description: "Devuelve estado, progreso y (si terminó) el resultado de una tarea iniciada con iniciar_tarea. Sin id, lista las tareas recientes.",
      inputSchema: { tarea_id: z.string().uuid().optional() },
      annotations: READ_ONLY_LOCAL,
    },
    handler(d.logger, "consultar_tarea", async (a) => (a.tarea_id ? { tarea: d.tasks.get(a.tarea_id) } : { tareas: d.tasks.list() })),
  );

  server.registerTool(
    "cancelar_tarea",
    {
      title: "Cancelar tarea",
      description: "Cancela una tarea en cola o en ejecución.",
      inputSchema: { tarea_id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    handler(d.logger, "cancelar_tarea", async (a) => ({ tarea: d.tasks.cancel(a.tarea_id) })),
  );
}
