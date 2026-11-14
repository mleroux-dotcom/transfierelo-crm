import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "si", "sí", "on"].includes(v.toLowerCase())));

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_PORT: int(3333, 1, 65535),
  MCP_AUTH_TOKEN: optionalString,
  MCP_ALLOW_NO_AUTH: bool(false),
  MCP_ALLOWED_HOSTS: list,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  CACHE_TTL_SECONDS: int(300, 0, 86_400),
  CACHE_MAX_ENTRIES: int(1000, 10, 100_000),
  HTTP_TIMEOUT_MS: int(15_000, 1000, 120_000),
  HTTP_RETRIES: int(3, 0, 10),
  SOURCE_TIMEOUT_MS: int(12_000, 1000, 120_000),

  SOURCES_DISABLED: list,
  CONTACT_EMAIL: optionalString,
  WIKIPEDIA_LANG: z.string().regex(/^[a-z-]{2,12}$/).default("es"),
  GITHUB_TOKEN: optionalString,
  NCBI_API_KEY: optionalString,
  BRAVE_API_KEY: optionalString,
  SEARXNG_URL: optionalString,
  ALLOW_PRIVATE_URLS: bool(false),
  MAX_DOWNLOAD_MB: int(20, 1, 200),

  DOCS_DIR: optionalString,
  DOCS_MAX_FILE_MB: int(25, 1, 500),

  CRM_BASE_URL: optionalString,
  CRM_API_KEY: optionalString,
  ALLOW_WRITES: bool(false),

  TASKS_MAX_CONCURRENT: int(2, 1, 20),
});

export type Config = z.infer<typeof EnvSchema>;

export const SOURCE_IDS = [
  "wikipedia",
  "wikidata",
  "openalex",
  "crossref",
  "pubmed",
  "arxiv",
  "worldbank",
  "github",
  "web",
  "busqueda_web",
  "feeds",
  "documentos",
  "crm",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // PaaS (Railway, Render, Heroku…) inject PORT; use it when MCP_HTTP_PORT is not set.
  if (!env.MCP_HTTP_PORT && env.PORT) env = { ...env, MCP_HTTP_PORT: env.PORT };
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida en variables de entorno: ${issues}. Revisa .env.example.`);
  }
  const cfg = parsed.data;
  const unknown = cfg.SOURCES_DISABLED.filter((s) => !(SOURCE_IDS as readonly string[]).includes(s));
  if (unknown.length) {
    throw new Error(`SOURCES_DISABLED contiene fuentes desconocidas: ${unknown.join(", ")}. Válidas: ${SOURCE_IDS.join(", ")}.`);
  }
  if (cfg.CRM_BASE_URL && !/^https?:\/\//.test(cfg.CRM_BASE_URL)) {
    throw new Error("CRM_BASE_URL debe empezar por http:// o https://");
  }
  return cfg;
}

/** Why a source is (in)active; used by listar_fuentes and to decide which tools to register. */
export function sourceStatus(cfg: Config): Record<SourceId, { activa: boolean; motivo: string }> {
  const disabled = new Set(cfg.SOURCES_DISABLED);
  const st = (id: SourceId, ok: boolean, missing: string) => {
    if (disabled.has(id)) return { activa: false, motivo: "desactivada en SOURCES_DISABLED" };
    return ok ? { activa: true, motivo: "ok" } : { activa: false, motivo: missing };
  };
  return {
    wikipedia: st("wikipedia", true, ""),
    wikidata: st("wikidata", true, ""),
    openalex: st("openalex", true, ""),
    crossref: st("crossref", true, ""),
    pubmed: st("pubmed", true, ""),
    arxiv: st("arxiv", true, ""),
    worldbank: st("worldbank", true, ""),
    github: st("github", true, ""),
    web: st("web", true, ""),
    busqueda_web: st("busqueda_web", !!(cfg.BRAVE_API_KEY || cfg.SEARXNG_URL), "falta BRAVE_API_KEY o SEARXNG_URL"),
    feeds: st("feeds", true, ""),
    documentos: st("documentos", !!cfg.DOCS_DIR, "falta DOCS_DIR (carpeta de documentos)"),
    crm: st("crm", !!(cfg.CRM_BASE_URL && cfg.CRM_API_KEY), "faltan CRM_BASE_URL y/o CRM_API_KEY"),
  };
}
