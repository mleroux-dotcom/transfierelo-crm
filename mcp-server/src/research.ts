import { sourceStatus, type SourceId } from "./config.js";
import { SourceError, toSourceError } from "./errors.js";
import { nowIso, type Evidencia } from "./evidence.js";
import { normalizeDoi, normalizeUrl, tokenize, truncate } from "./text.js";
import type { SourceContext } from "./sources/context.js";
import type { DocumentIndex } from "./sources/documents.js";
import type { CrmClient } from "./sources/crm.js";
import { resumenesWikipedia, obtenerArticuloWikipedia } from "./sources/wikipedia.js";
import { consultarWikidata } from "./sources/wikidata.js";
import { buscarPapers, fromOpenAlex, obtenerPaper } from "./sources/papers.js";
import { buscarGithub, obtenerRepoGithub } from "./sources/github.js";
import { buscarWeb, leerUrl } from "./sources/web.js";

export interface ResearchDeps extends SourceContext {
  docs?: DocumentIndex;
  crm?: CrmClient;
}

/** Sources that `investigar` can query with free text. */
export const RESEARCH_SOURCES = ["wikipedia", "wikidata", "openalex", "crossref", "pubmed", "arxiv", "github", "busqueda_web", "documentos", "crm"] as const;
export type ResearchSource = (typeof RESEARCH_SOURCES)[number];
const DEFAULT_SOURCES: ResearchSource[] = ["wikipedia", "wikidata", "openalex", "pubmed", "arxiv", "github", "busqueda_web", "documentos", "crm"];

type Runner = (q: string, n: number) => Promise<Evidencia[]>;

function runners(d: ResearchDeps): Record<ResearchSource, Runner> {
  const papers = (fuente: "openalex" | "crossref" | "pubmed" | "arxiv") => async (q: string, n: number) => (await buscarPapers(d, { query: q, fuente, pagina: 1, por_pagina: n })).resultados;
  return {
    wikipedia: (q, n) => resumenesWikipedia(d, q, n),
    wikidata: async (q, n) => {
      const { entidades } = await consultarWikidata(d, { query: q, max_resultados: Math.min(n, 3) });
      return entidades.map(({ entidad, propiedades }) => ({
        ...entidad,
        extracto: truncate([entidad.extracto, ...propiedades.slice(0, 8).map((p) => `${p.propiedad}: ${p.valores.map((v) => v.valor + (v.fecha_referencia ? ` (${v.fecha_referencia})` : "")).join(", ")}`)].filter(Boolean).join(" | "), 700),
      }));
    },
    openalex: papers("openalex"),
    crossref: papers("crossref"),
    pubmed: papers("pubmed"),
    arxiv: papers("arxiv"),
    github: async (q, n) => (await buscarGithub(d, { query: q, tipo: "repos", pagina: 1, por_pagina: n })).resultados,
    busqueda_web: async (q, n) => (await buscarWeb(d, { query: q, pagina: 1, por_pagina: n })).resultados,
    documentos: async (q, n) => (await d.docs!.search(q, { pagina: 1, por_pagina: n })).resultados,
    crm: async (q, n) => {
      const [contacts, companies, deals] = await Promise.all([d.crm!.list("contacts", { q }), d.crm!.list("companies", { q }), d.crm!.list("deals", { q })]);
      return [
        ...contacts.slice(0, n).map((r) => d.crm!.evidencia("contacts", r)),
        ...companies.slice(0, n).map((r) => d.crm!.evidencia("companies", r)),
        ...deals.slice(0, n).map((r) => d.crm!.evidencia("deals", r)),
      ];
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, source: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new SourceError("timeout", `${source} superó ${ms} ms`, "Se omitió esta fuente; reintenta o consúltala directamente con su tool.", true, source)), ms);
    }),
  ]);
}

const RELIABILITY_WEIGHT = { alta: 1, media: 0.6, baja: 0.3 } as const;

function relevance(q: string[], e: Evidencia): number {
  if (!q.length) return 0;
  const hay = new Set(tokenize(`${e.titulo} ${e.extracto}`));
  return q.filter((t) => hay.has(t)).length / q.length;
}

function dedupKey(e: Evidencia): string {
  const doi = normalizeDoi(e.id.startsWith("doi:") ? e.id : (e.datos?.doi as string | undefined));
  return doi ? `doi:${doi}` : (normalizeUrl(e.url) ?? e.id);
}

export interface FuenteReporte {
  fuente: ResearchSource;
  estado: "ok" | "error" | "inactiva";
  resultados: number;
  ms?: number;
  error?: string;
}

export interface ResultadoInvestigacion {
  pregunta: string;
  consultado_en: string;
  resultados: (Evidencia & { relevancia: number })[];
  fuentes: FuenteReporte[];
  cobertura: string;
  instrucciones: string;
}

export const GROUNDING_INSTRUCTIONS =
  "Responde SOLO con información presente en estos resultados y cita cada afirmación con su url y fecha. " +
  "Prioriza fiabilidad 'alta'. Si los resultados no responden la pregunta, dilo explícitamente en lugar de completar con conocimiento propio; " +
  "si aun así aportas conocimiento general, márcalo como 'no verificado'. Si hay fuentes con error, menciónalo como limitación.";

export async function investigar(d: ResearchDeps, p: { pregunta: string; fuentes?: ResearchSource[]; max_por_fuente: number; max_resultados: number }): Promise<ResultadoInvestigacion> {
  const status = sourceStatus(d.cfg);
  const requested = p.fuentes?.length ? p.fuentes : DEFAULT_SOURCES;
  const run = runners(d);

  const fuentes: FuenteReporte[] = [];
  const settled = await Promise.all(
    requested.map(async (src) => {
      const st = status[src as SourceId];
      if (!st.activa) {
        fuentes.push({ fuente: src, estado: "inactiva", resultados: 0, error: st.motivo });
        return [] as Evidencia[];
      }
      const t0 = Date.now();
      try {
        const items = await withTimeout(run[src](p.pregunta, p.max_por_fuente), d.cfg.SOURCE_TIMEOUT_MS, src);
        fuentes.push({ fuente: src, estado: "ok", resultados: items.length, ms: Date.now() - t0 });
        return items.map((e, i) => ({ e, i }));
      } catch (err) {
        const se = toSourceError(err, src);
        d.logger.warn("fuente falló en investigar", { fuente: src, code: se.code, error: se.message });
        fuentes.push({ fuente: src, estado: "error", resultados: 0, ms: Date.now() - t0, error: `${se.code}: ${se.message}` });
        return [];
      }
    }),
  );

  const q = [...new Set(tokenize(p.pregunta))];
  const merged = new Map<string, { e: Evidencia; score: number; rel: number; also: Set<string> }>();
  for (const list of settled) {
    for (const item of list as { e: Evidencia; i: number }[]) {
      const rel = relevance(q, item.e);
      const score = rel * 0.6 + RELIABILITY_WEIGHT[item.e.fiabilidad] * 0.3 + 0.1 / (1 + item.i);
      const key = dedupKey(item.e);
      const prev = merged.get(key);
      if (!prev) merged.set(key, { e: item.e, score, rel, also: new Set() });
      else {
        prev.also.add(item.e.fuente);
        if (score > prev.score) {
          prev.also.add(prev.e.fuente);
          prev.also.delete(item.e.fuente);
          Object.assign(prev, { e: item.e, score, rel });
        }
      }
    }
  }
  const resultados = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, p.max_resultados)
    .map(({ e, rel, also }) => ({ ...e, relevancia: Number(rel.toFixed(2)), ...(also.size ? { datos: { ...e.datos, tambien_en: [...also] } } : {}) }));

  fuentes.sort((a, b) => requested.indexOf(a.fuente) - requested.indexOf(b.fuente));
  const ok = fuentes.filter((f) => f.estado === "ok").length;
  return {
    pregunta: p.pregunta,
    consultado_en: nowIso(),
    resultados,
    fuentes,
    cobertura: `${ok} de ${fuentes.length} fuentes respondieron; ${resultados.length} resultados únicos${resultados.length ? "" : " — NO se encontró información verificable"}.`,
    instrucciones: GROUNDING_INSTRUCTIONS,
  };
}

/** Runs async work over items with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/**
 * Deep research: broad search, then read the full content of the best hits, then follow
 * related academic work. Meant to run as a background task.
 */
export async function investigacionProfunda(
  d: ResearchDeps,
  p: { pregunta: string; fuentes?: ResearchSource[]; profundidad: number },
  progress: (pct: number, msg: string) => void,
  signal: AbortSignal,
) {
  const checkCancel = () => {
    if (signal.aborted) throw new SourceError("internal", "Tarea cancelada", "—");
  };
  progress(5, "búsqueda amplia en todas las fuentes");
  const base = await investigar(d, { pregunta: p.pregunta, fuentes: p.fuentes, max_por_fuente: 5, max_resultados: 20 });
  checkCancel();

  const top = base.resultados.slice(0, p.profundidad);
  progress(35, `leyendo el contenido completo de ${top.length} resultados`);
  let done = 0;
  const leidos = await mapLimit(top, 3, async (e) => {
    checkCancel();
    try {
      return { evidencia: e, ...(await leerCompleto(d, e)) };
    } catch (err) {
      return { evidencia: e, error: toSourceError(err).message, relacionados: [] as string[] };
    } finally {
      progress(35 + Math.round((++done / Math.max(1, top.length)) * 45), `leído ${done}/${top.length}`);
    }
  });
  checkCancel();

  progress(85, "buscando trabajos académicos relacionados");
  const oaIds = [...new Set(leidos.flatMap((h) => h.relacionados ?? []))].slice(0, 10);
  let relacionados: Evidencia[] = [];
  if (oaIds.length) {
    try {
      const filter = oaIds.map((x) => x.replace("openalex:", "")).join("|");
      const { body } = await d.http.json<any>(`https://api.openalex.org/works?filter=openalex_id:${filter}&per-page=10`, { source: "openalex" });
      relacionados = (body?.results ?? []).map(fromOpenAlex);
    } catch (err) {
      d.logger.warn("no se pudieron obtener trabajos relacionados", { error: (err as Error).message });
    }
  }
  progress(100, "listo");
  return {
    pregunta: p.pregunta,
    consultado_en: nowIso(),
    hallazgos: leidos.map(({ relacionados: _r, ...h }) => h),
    relacionados,
    fuentes: base.fuentes,
    cobertura: base.cobertura,
    instrucciones: GROUNDING_INSTRUCTIONS,
  };
}

/** Reads the full content behind a search hit, using the matching detail tool. */
async function leerCompleto(d: ResearchDeps, e: Evidencia): Promise<{ contenido?: string; relacionados?: string[] }> {
  const MAX = 4000;
  if (/^(doi|pmid|arxiv|openalex):/.test(e.id)) {
    const det = await obtenerPaper(d, e.id);
    return { contenido: det.resumen ? truncate(det.resumen, MAX) : undefined, relacionados: det.relacionados };
  }
  if (e.id.startsWith("wikipedia:")) {
    const [, lang, ...rest] = e.id.split(":");
    return { contenido: (await obtenerArticuloWikipedia(d, { titulo: rest.join(":"), idioma: lang, desde_caracter: 0, max_caracteres: MAX })).texto };
  }
  if (/^github:[\w.-]+\/[\w.-]+$/.test(e.id)) return { contenido: (await obtenerRepoGithub(d, { repo: e.id.slice(7), max_caracteres_readme: MAX })).readme };
  if (e.id.startsWith("doc:") && d.docs) return { contenido: (await d.docs.get(e.id, { desde_caracter: 0, max_caracteres: MAX })).texto };
  if (e.id.startsWith("web:") && e.url) return { contenido: (await leerUrl(d, { url: e.url, desde_caracter: 0, max_caracteres: MAX })).texto };
  return {};
}
