import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sourceStatus } from "../config.js";
import { PaginaSchema } from "../evidence.js";
import { SourceError } from "../errors.js";
import { buscarWikipedia, obtenerArticuloWikipedia } from "../sources/wikipedia.js";
import { consultarWikidata } from "../sources/wikidata.js";
import { buscarPapers, obtenerPaper, PAPER_SOURCES } from "../sources/papers.js";
import { buscarIndicadorBancoMundial, datosBancoMundial } from "../sources/worldbank.js";
import { buscarGithub, GITHUB_TIPOS, obtenerArchivoGithub, obtenerRepoGithub } from "../sources/github.js";
import { buscarWeb, leerFeed, leerUrl } from "../sources/web.js";
import { handler, paginacion, READ_ONLY, READ_ONLY_LOCAL, ventanaTexto, type AppDeps } from "./helpers.js";

const idioma = z.string().regex(/^[a-z-]{2,12}$/).optional().describe("Código de idioma de Wikipedia (es, en, pt, fr…). Por defecto WIKIPEDIA_LANG.");
const anio = z.number().int().min(1500).max(2100);

export function registerSourceTools(server: McpServer, d: AppDeps) {
  const on = sourceStatus(d.cfg);
  const log = d.logger;

  if (on.wikipedia.activa) {
    server.registerTool(
      "buscar_wikipedia",
      {
        title: "Buscar en Wikipedia",
        description: "Busca artículos de Wikipedia por palabras clave. Úsala para definiciones, contexto histórico, biografías y conceptos generales. Devuelve títulos con extracto y fecha de última edición; lee el artículo con obtener_articulo_wikipedia.",
        inputSchema: { query: z.string().min(1).max(300), idioma, ...paginacion },
        outputSchema: PaginaSchema.shape,
        annotations: READ_ONLY,
      },
      handler(log, "buscar_wikipedia", (a) => buscarWikipedia(d, a)),
    );
    server.registerTool(
      "obtener_articulo_wikipedia",
      {
        title: "Leer artículo de Wikipedia",
        description: "Devuelve el texto plano de un artículo de Wikipedia (por título exacto), paginado por caracteres, con URL y fecha de la última revisión.",
        inputSchema: { titulo: z.string().min(1).max(300), idioma, ...ventanaTexto },
        annotations: READ_ONLY,
      },
      handler(log, "obtener_articulo_wikipedia", (a) => obtenerArticuloWikipedia(d, a)),
    );
  }

  if (on.wikidata.activa) {
    server.registerTool(
      "consultar_wikidata",
      {
        title: "Consultar Wikidata",
        description:
          "Datos estructurados y verificables sobre entidades (personas, países, empresas, obras): fechas de nacimiento/fundación, población, capital, sede, CEO, etc. " +
          "Busca por nombre (query) o por id (Q42). Cada valor indica si tiene referencias. Prefiérela a Wikipedia para cifras y fechas puntuales.",
        inputSchema: {
          query: z.string().min(1).max(200).optional(),
          id: z.string().regex(/^Q\d+$/).optional().describe("Id de Wikidata, p. ej. Q298 (Chile)."),
          idioma,
          propiedades: z.array(z.string().regex(/^P\d+$/)).max(30).optional().describe("Propiedades específicas (P1082 población, P36 capital, P571 fundación...). Por defecto, un conjunto común."),
          max_resultados: z.number().int().min(1).max(10).default(3),
        },
        annotations: READ_ONLY,
      },
      handler(log, "consultar_wikidata", async (a) => {
        if (!a.query && !a.id) throw new SourceError("invalid_input", "Indica query o id.", "Pasa el nombre de la entidad en query, o su id Q en id.");
        return consultarWikidata(d, a);
      }),
    );
  }

  const paperSources = PAPER_SOURCES.filter((s) => on[s].activa);
  if (paperSources.length) {
    server.registerTool(
      "buscar_papers",
      {
        title: "Buscar literatura académica",
        description:
          "Busca papers y publicaciones científicas. Fuentes: openalex (general, por defecto, incluye nº de citas), crossref (metadatos de DOIs), pubmed (biomedicina y salud), arxiv (preprints de física, IA, matemáticas). " +
          "Úsala para afirmaciones científicas, médicas o técnicas. Para leer el resumen completo usa obtener_paper.",
        inputSchema: {
          query: z.string().min(2).max(300).describe("Términos de búsqueda; en inglés suelen dar más resultados."),
          fuente: z.enum(PAPER_SOURCES).default(paperSources[0]!).describe(`Activas: ${paperSources.join(", ")}`),
          desde_anio: anio.optional(),
          hasta_anio: anio.optional(),
          ...paginacion,
        },
        outputSchema: PaginaSchema.shape,
        annotations: READ_ONLY,
      },
      handler(log, "buscar_papers", async (a) => {
        if (!paperSources.includes(a.fuente)) throw new SourceError("source_disabled", `La fuente ${a.fuente} está desactivada.`, `Usa una de: ${paperSources.join(", ")}.`);
        return buscarPapers(d, a);
      }),
    );
    server.registerTool(
      "obtener_paper",
      {
        title: "Detalle de un paper",
        description: 'Detalle completo de una publicación: resumen, autores, revista, citas, referencias y trabajos relacionados. Acepta DOI ("10.1038/…"), "pmid:12345", "arxiv:2101.00001" u "openalex:W123".',
        inputSchema: { id: z.string().min(3).max(300) },
        annotations: READ_ONLY,
      },
      handler(log, "obtener_paper", (a) => obtenerPaper(d, a.id)),
    );
  }

  if (on.worldbank.activa) {
    server.registerTool(
      "buscar_indicador_banco_mundial",
      {
        title: "Buscar indicador del Banco Mundial",
        description: "Encuentra el código de un indicador oficial del Banco Mundial (WDI) por palabras clave en inglés, p. ej. 'GDP per capita', 'inflation', 'unemployment', 'life expectancy'. Luego usa datos_banco_mundial.",
        inputSchema: { query: z.string().min(2).max(200), max_resultados: z.number().int().min(1).max(30).default(10) },
        annotations: READ_ONLY,
      },
      handler(log, "buscar_indicador_banco_mundial", (a) => buscarIndicadorBancoMundial(d, a)),
    );
    server.registerTool(
      "datos_banco_mundial",
      {
        title: "Datos oficiales del Banco Mundial",
        description:
          "Series estadísticas oficiales por país y año (PIB, población, inflación, desempleo, pobreza, salud, educación...). Fuente de fiabilidad alta para cifras macro. " +
          "Códigos comunes: NY.GDP.MKTP.CD (PIB US$), NY.GDP.PCAP.CD (PIB per cápita), SP.POP.TOTL (población), FP.CPI.TOTL.ZG (inflación), SL.UEM.TOTL.ZS (desempleo), SP.DYN.LE00.IN (esperanza de vida).",
        inputSchema: {
          indicador: z.string().regex(/^[A-Za-z0-9._]+$/).describe("Código del indicador, p. ej. NY.GDP.PCAP.CD"),
          paises: z.array(z.string().regex(/^[A-Za-z0-9]{2,3}$/)).min(1).max(20).describe("Códigos ISO2/ISO3 (CL, ARG) o agregados (WLD, LCN)."),
          desde_anio: anio.optional(),
          hasta_anio: anio.optional(),
        },
        annotations: READ_ONLY,
      },
      handler(log, "datos_banco_mundial", (a) => datosBancoMundial(d, a)),
    );
  }

  if (on.github.activa) {
    server.registerTool(
      "buscar_github",
      {
        title: "Buscar en GitHub",
        description:
          "Busca repositorios, código o issues/PRs públicos en GitHub. Úsala para preguntas sobre librerías, implementaciones de referencia, bugs conocidos o versiones. " +
          "Admite calificadores de GitHub (language:typescript, stars:>100, repo:owner/name). La búsqueda de código requiere GITHUB_TOKEN.",
        inputSchema: { query: z.string().min(1).max(256), tipo: z.enum(GITHUB_TIPOS).default("repos"), ...paginacion },
        outputSchema: PaginaSchema.shape,
        annotations: READ_ONLY,
      },
      handler(log, "buscar_github", (a) => buscarGithub(d, a)),
    );
    server.registerTool(
      "obtener_repo_github",
      {
        title: "Detalle de repositorio",
        description: "Metadatos de un repositorio (estrellas, licencia, última actividad, última versión publicada) y su README.",
        inputSchema: { repo: z.string().describe('"owner/repo"'), max_caracteres_readme: z.number().int().min(200).max(50_000).default(6000) },
        annotations: READ_ONLY,
      },
      handler(log, "obtener_repo_github", (a) => obtenerRepoGithub(d, a)),
    );
    server.registerTool(
      "obtener_archivo_github",
      {
        title: "Leer archivo de GitHub",
        description: "Lee un archivo (o lista un directorio) de un repositorio, con fecha del último commit que lo modificó. Para citar código o documentación exacta.",
        inputSchema: { repo: z.string().describe('"owner/repo"'), ruta: z.string().max(500).default(""), ref: z.string().max(200).optional().describe("Rama, tag o commit."), ...ventanaTexto },
        annotations: READ_ONLY,
      },
      handler(log, "obtener_archivo_github", (a) => obtenerArchivoGithub(d, a)),
    );
  }

  if (on.web.activa) {
    server.registerTool(
      "leer_url",
      {
        title: "Leer cualquier URL",
        description:
          "Descarga una página o archivo público (HTML, PDF, DOCX, JSON, texto) y devuelve su texto legible con título, fechas y fiabilidad según el dominio. " +
          "Úsala para leer una fuente concreta encontrada por otra tool o indicada por el usuario. Bloquea direcciones internas por seguridad.",
        inputSchema: { url: z.string().url().max(2000), ...ventanaTexto },
        annotations: READ_ONLY,
      },
      handler(log, "leer_url", (a) => leerUrl(d, a)),
    );
  }

  if (on.busqueda_web.activa) {
    server.registerTool(
      "buscar_web",
      {
        title: "Buscar en la web",
        description: "Búsqueda web general (Brave Search o SearXNG). Úsala para hechos recientes, noticias, sitios oficiales o temas sin cobertura académica/enciclopédica. Lee los resultados importantes con leer_url antes de afirmar algo.",
        inputSchema: { query: z.string().min(1).max(400), recientes: z.enum(["dia", "semana", "mes", "anio"]).optional(), pagina: paginacion.pagina, por_pagina: z.number().int().min(1).max(20).default(10) },
        outputSchema: PaginaSchema.shape,
        annotations: READ_ONLY,
      },
      handler(log, "buscar_web", (a) => buscarWeb(d, a)),
    );
  }

  if (on.feeds.activa) {
    server.registerTool(
      "leer_feed",
      {
        title: "Leer feed RSS/Atom",
        description: "Lee las últimas entradas de un feed RSS o Atom (noticias, blogs oficiales, boletines, releases). Útil para novedades con fecha exacta.",
        inputSchema: { url: z.string().url().max(2000), max_items: z.number().int().min(1).max(50).default(15), pagina: paginacion.pagina },
        annotations: READ_ONLY,
      },
      handler(log, "leer_feed", (a) => leerFeed(d, a)),
    );
  }

  if (on.documentos.activa && d.docs) {
    const docs = d.docs;
    server.registerTool(
      "buscar_documentos",
      {
        title: "Buscar en documentos propios",
        description: "Búsqueda de texto completo (BM25) en la carpeta de documentos del usuario (PDF, DOCX, MD, TXT, HTML, CSV, JSON). Úsala PRIMERO para preguntas sobre políticas, contratos, manuales o datos internos. Cita archivo y página.",
        inputSchema: { query: z.string().min(1).max(500), archivo: z.string().max(300).optional().describe("Filtra por parte de la ruta del archivo."), ...paginacion },
        outputSchema: PaginaSchema.shape,
        annotations: READ_ONLY_LOCAL,
      },
      handler(log, "buscar_documentos", (a) => docs.search(a.query, a)),
    );
    server.registerTool(
      "obtener_documento",
      {
        title: "Leer documento propio",
        description: "Lee el texto de un documento de la carpeta (por id 'doc:ruta#n' o ruta relativa), opcionalmente una página concreta de un PDF.",
        inputSchema: { id: z.string().min(1).max(500), pagina_pdf: z.number().int().min(1).optional(), ...ventanaTexto },
        annotations: READ_ONLY_LOCAL,
      },
      handler(log, "obtener_documento", (a) => docs.get(a.id, a)),
    );
  }
}
