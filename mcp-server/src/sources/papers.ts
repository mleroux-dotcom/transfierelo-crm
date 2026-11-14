import { XMLParser } from "fast-xml-parser";
import { SourceError } from "../errors.js";
import { isPeerReviewedType, makeEvidencia, pagina, type Evidencia, type Pagina } from "../evidence.js";
import { normalizeDoi, stripTags, toIsoDate, truncate } from "../text.js";
import { qs, type SourceContext } from "./context.js";

export const PAPER_SOURCES = ["openalex", "crossref", "pubmed", "arxiv"] as const;
export type PaperSource = (typeof PAPER_SOURCES)[number];

export interface BuscarPapersInput {
  query: string;
  fuente: PaperSource;
  desde_anio?: number;
  hasta_anio?: number;
  pagina: number;
  por_pagina: number;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", isArray: (name) => ["entry", "author", "link", "AbstractText", "PubmedArticle", "Author"].includes(name) });

const EXTRACT_LEN = 600;

// ---------- OpenAlex ----------

function openAlexAbstract(inv?: Record<string, number[]> | null): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, positions] of Object.entries(inv)) for (const p of positions) words[p] = w;
  return words.filter(Boolean).join(" ");
}

export function fromOpenAlex(w: any): Evidencia {
  const source = w.primary_location?.source;
  const isPreprint = w.type === "preprint" || source?.type === "repository";
  const doi = normalizeDoi(w.doi);
  const abstract = openAlexAbstract(w.abstract_inverted_index);
  return makeEvidencia({
    id: doi ? `doi:${doi}` : `openalex:${String(w.id).split("/").pop()}`,
    titulo: w.display_name ?? w.title ?? "(sin título)",
    extracto: truncate(abstract || "(OpenAlex no incluye el resumen de este trabajo)", EXTRACT_LEN),
    url: doi ? `https://doi.org/${doi}` : w.id,
    fuente: "openalex",
    tipo: isPreprint ? "preprint" : "paper",
    autores: (w.authorships ?? []).slice(0, 8).map((a: any) => a.author?.display_name).filter(Boolean),
    fecha_publicacion: w.publication_date,
    datos: {
      revista: source?.display_name,
      citas: w.cited_by_count,
      tipo_publicacion: w.type,
      acceso_abierto: w.open_access?.oa_url,
      openalex_id: String(w.id).split("/").pop(),
    },
    fiab: { tipo: isPreprint ? "preprint" : "paper", revisado_por_pares: !isPreprint && source?.type === "journal" && isPeerReviewedType(w.type), citas: w.cited_by_count, retractado: !!w.is_retracted },
  });
}

async function buscarOpenAlex(ctx: SourceContext, p: BuscarPapersInput): Promise<Pagina> {
  const filters = [p.desde_anio && `from_publication_date:${p.desde_anio}-01-01`, p.hasta_anio && `to_publication_date:${p.hasta_anio}-12-31`].filter(Boolean).join(",");
  const url = `https://api.openalex.org/works?${qs({ search: p.query, "per-page": p.por_pagina, page: p.pagina, filter: filters || undefined, mailto: ctx.cfg.CONTACT_EMAIL })}`;
  const { body } = await ctx.http.json<any>(url, { source: "openalex" });
  return pagina((body?.results ?? []).map(fromOpenAlex), { pagina: p.pagina, por_pagina: p.por_pagina, total: body?.meta?.count });
}

// ---------- Crossref ----------

function crossrefDate(m: any): string | undefined {
  const parts = (m.published ?? m["published-print"] ?? m["published-online"] ?? m.issued)?.["date-parts"]?.[0];
  if (!parts?.[0]) return undefined;
  return parts.map((n: number, i: number) => (i === 0 ? String(n) : String(n).padStart(2, "0"))).join("-");
}

function fromCrossref(m: any): Evidencia {
  const doi = normalizeDoi(m.DOI)!;
  const isPreprint = m.type === "posted-content";
  const retracted = (m["update-to"] ?? []).some((u: any) => /retraction/i.test(u.type)) || /^retracted/i.test(m.title?.[0] ?? "");
  return makeEvidencia({
    id: `doi:${doi}`,
    titulo: stripTags(m.title?.[0] ?? "(sin título)"),
    extracto: truncate(m.abstract ? stripTags(m.abstract) : "(Crossref no incluye el resumen de este trabajo)", EXTRACT_LEN),
    url: `https://doi.org/${doi}`,
    fuente: "crossref",
    tipo: isPreprint ? "preprint" : "paper",
    autores: (m.author ?? []).slice(0, 8).map((a: any) => [a.given, a.family].filter(Boolean).join(" ") || a.name).filter(Boolean),
    fecha_publicacion: crossrefDate(m),
    datos: { revista: m["container-title"]?.[0], editorial: m.publisher, citas: m["is-referenced-by-count"], tipo_publicacion: m.type },
    fiab: { tipo: isPreprint ? "preprint" : "paper", revisado_por_pares: isPeerReviewedType(m.type), citas: m["is-referenced-by-count"], retractado: retracted },
  });
}

async function buscarCrossref(ctx: SourceContext, p: BuscarPapersInput): Promise<Pagina> {
  const filters = [p.desde_anio && `from-pub-date:${p.desde_anio}`, p.hasta_anio && `until-pub-date:${p.hasta_anio}`].filter(Boolean).join(",");
  const url = `https://api.crossref.org/works?${qs({ query: p.query, rows: p.por_pagina, offset: (p.pagina - 1) * p.por_pagina, filter: filters || undefined, mailto: ctx.cfg.CONTACT_EMAIL })}`;
  const { body } = await ctx.http.json<any>(url, { source: "crossref" });
  return pagina((body?.message?.items ?? []).map(fromCrossref), { pagina: p.pagina, por_pagina: p.por_pagina, total: body?.message?.["total-results"] });
}

// ---------- PubMed ----------

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const ncbiParams = (ctx: SourceContext) => ({ tool: "fuentes-mcp", email: ctx.cfg.CONTACT_EMAIL, api_key: ctx.cfg.NCBI_API_KEY });

function fromPubmedSummary(r: any, abstract?: string): Evidencia {
  const doi = normalizeDoi((r.articleids ?? []).find((a: any) => a.idtype === "doi")?.value);
  const retracted = (r.pubtype ?? []).some((t: string) => /retracted/i.test(t));
  return makeEvidencia({
    id: `pmid:${r.uid}`,
    titulo: stripTags(r.title ?? "(sin título)"),
    extracto: truncate(abstract ?? "(usa obtener_paper para leer el resumen)", abstract ? 4000 : EXTRACT_LEN),
    url: `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`,
    fuente: "pubmed",
    tipo: "paper",
    autores: (r.authors ?? []).slice(0, 8).map((a: any) => a.name),
    fecha_publicacion: toIsoDate(r.sortpubdate) ?? r.pubdate,
    datos: { revista: r.fulljournalname ?? r.source, doi, tipos: r.pubtype },
    fiab: { tipo: "paper", revisado_por_pares: true, retractado: retracted },
  });
}

async function pubmedSummaries(ctx: SourceContext, ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  const { body } = await ctx.http.json<any>(`${EUTILS}/esummary.fcgi?${qs({ db: "pubmed", id: ids.join(","), retmode: "json", ...ncbiParams(ctx) })}`, { source: "pubmed" });
  return (body?.result?.uids ?? ids).map((id: string) => body?.result?.[id]).filter((r: any) => r && !r.error);
}

async function buscarPubmed(ctx: SourceContext, p: BuscarPapersInput): Promise<Pagina> {
  const url = `${EUTILS}/esearch.fcgi?${qs({
    db: "pubmed",
    term: p.query,
    retmode: "json",
    retmax: p.por_pagina,
    retstart: (p.pagina - 1) * p.por_pagina,
    sort: "relevance",
    datetype: p.desde_anio || p.hasta_anio ? "pdat" : undefined,
    mindate: p.desde_anio ?? (p.hasta_anio ? 1800 : undefined),
    maxdate: p.hasta_anio ?? (p.desde_anio ? new Date().getFullYear() : undefined),
    ...ncbiParams(ctx),
  })}`;
  const { body } = await ctx.http.json<any>(url, { source: "pubmed" });
  const ids: string[] = body?.esearchresult?.idlist ?? [];
  const total = Number(body?.esearchresult?.count ?? 0);
  const sums = await pubmedSummaries(ctx, ids);
  return pagina(sums.map((s) => fromPubmedSummary(s)), { pagina: p.pagina, por_pagina: p.por_pagina, total });
}

function textOf(node: any): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return Object.entries(node)
    .filter(([k]) => !k.startsWith("@"))
    .map(([, v]) => textOf(v))
    .join(" ");
}

async function pubmedAbstract(ctx: SourceContext, pmid: string): Promise<string | undefined> {
  const { body } = await ctx.http.text(`${EUTILS}/efetch.fcgi?${qs({ db: "pubmed", id: pmid, retmode: "xml", ...ncbiParams(ctx) })}`, { source: "pubmed" });
  // Inline markup (<i>, <sup>…) would make the XML parser reorder mixed text; drop it first.
  const doc = xml.parse(body.replace(/<\/?(i|b|u|em|strong|sup|sub|br)\s*\/?>/gi, ""));
  const parts: any[] = doc?.PubmedArticleSet?.PubmedArticle?.[0]?.MedlineCitation?.Article?.Abstract?.AbstractText ?? [];
  const text = parts.map((p) => (p?.["@Label"] ? `${p["@Label"]}: ` : "") + textOf(p).replace(/\s+/g, " ").trim()).join("\n");
  return text || undefined;
}

// ---------- arXiv ----------

function fromArxiv(e: any): Evidencia {
  const absUrl: string = typeof e.id === "string" ? e.id : textOf(e.id);
  const arxivId = absUrl.split("/abs/").pop()!.replace(/v\d+$/, "");
  const doi = normalizeDoi(textOf(e["arxiv:doi"]));
  return makeEvidencia({
    id: `arxiv:${arxivId}`,
    titulo: textOf(e.title).replace(/\s+/g, " ").trim(),
    extracto: truncate(textOf(e.summary).replace(/\s+/g, " ").trim(), EXTRACT_LEN),
    url: absUrl.replace(/^http:/, "https:"),
    fuente: "arxiv",
    tipo: doi ? "paper" : "preprint",
    autores: (e.author ?? []).slice(0, 8).map((a: any) => textOf(a.name)),
    fecha_publicacion: toIsoDate(textOf(e.published)),
    fecha_actualizacion: toIsoDate(textOf(e.updated)),
    datos: { doi, categoria: e["arxiv:primary_category"]?.["@term"], pdf: `https://arxiv.org/pdf/${arxivId}` },
    // An arXiv entry with a DOI has a published (journal) version; we still only claim "media" for the preprint text.
    fiab: { tipo: "preprint" },
  });
}

async function arxivQuery(ctx: SourceContext, params: Record<string, string | number | undefined>): Promise<{ entries: any[]; total: number }> {
  const { body } = await ctx.http.text(`https://export.arxiv.org/api/query?${qs(params)}`, { source: "arxiv" });
  const feed = xml.parse(body)?.feed ?? {};
  return { entries: feed.entry ?? [], total: Number(textOf(feed["opensearch:totalResults"]) || 0) };
}

async function buscarArxiv(ctx: SourceContext, p: BuscarPapersInput): Promise<Pagina> {
  const terms = p.query.trim().split(/\s+/).filter(Boolean).map((t) => `all:${t.replace(/[:()"]/g, "")}`);
  let search = terms.join(" AND ");
  if (p.desde_anio || p.hasta_anio) search += ` AND submittedDate:[${p.desde_anio ?? 1991}01010000 TO ${p.hasta_anio ?? 2100}12312359]`;
  const { entries, total } = await arxivQuery(ctx, { search_query: search, start: (p.pagina - 1) * p.por_pagina, max_results: p.por_pagina, sortBy: "relevance" });
  // arXiv returns a single "Error" entry for malformed queries.
  const real = entries.filter((e) => !/api\/errors/.test(textOf(e.id)));
  return pagina(real.map(fromArxiv), { pagina: p.pagina, por_pagina: p.por_pagina, total });
}

// ---------- public API ----------

export async function buscarPapers(ctx: SourceContext, p: BuscarPapersInput): Promise<Pagina> {
  switch (p.fuente) {
    case "openalex":
      return buscarOpenAlex(ctx, p);
    case "crossref":
      return buscarCrossref(ctx, p);
    case "pubmed":
      return buscarPubmed(ctx, p);
    case "arxiv":
      return buscarArxiv(ctx, p);
  }
}

export interface PaperDetalle {
  paper: Evidencia;
  resumen?: string;
  referencias?: string[];
  relacionados?: string[];
}

/** Accepts: a DOI (or doi.org URL), "doi:…", "pmid:123", "arxiv:2101.00001", "openalex:W123". */
export async function obtenerPaper(ctx: SourceContext, rawId: string): Promise<PaperDetalle> {
  const id = rawId.trim();
  const lower = id.toLowerCase();

  if (lower.startsWith("pmid:") || /^\d{5,9}$/.test(id)) {
    const pmid = id.replace(/^pmid:/i, "");
    const [sum] = await pubmedSummaries(ctx, [pmid]);
    if (!sum) throw new SourceError("not_found", `No existe el PMID ${pmid} en PubMed.`, "Verifica el número o busca el artículo con buscar_papers (fuente pubmed).", false, "pubmed");
    const resumen = await pubmedAbstract(ctx, pmid).catch(() => undefined);
    return { paper: fromPubmedSummary(sum, resumen), resumen };
  }

  if (lower.startsWith("arxiv:") || /^\d{4}\.\d{4,5}(v\d+)?$/.test(id)) {
    const aid = id.replace(/^arxiv:/i, "");
    const { entries } = await arxivQuery(ctx, { id_list: aid, max_results: 1 });
    const e = entries.find((x) => !/api\/errors/.test(textOf(x.id)));
    if (!e) throw new SourceError("not_found", `No existe el artículo arXiv ${aid}.`, "Verifica el identificador (ej. 2101.00001).", false, "arxiv");
    const paper = fromArxiv(e);
    return { paper, resumen: textOf(e.summary).replace(/\s+/g, " ").trim() };
  }

  const doi = normalizeDoi(id);
  const oaKey = lower.startsWith("openalex:") ? id.slice(9) : doi ? `doi:${doi}` : undefined;
  if (!oaKey) {
    throw new SourceError("invalid_input", `Identificador no reconocido: "${id}".`, 'Usa un DOI (10.xxxx/...), "pmid:123", "arxiv:2101.00001" u "openalex:W123".', false, "papers");
  }
  try {
    const { body: w } = await ctx.http.json<any>(`https://api.openalex.org/works/${encodeURIComponent(oaKey).replace("%3A", ":")}?${qs({ mailto: ctx.cfg.CONTACT_EMAIL })}`, { source: "openalex" });
    const paper = fromOpenAlex(w);
    const resumen = openAlexAbstract(w.abstract_inverted_index) || undefined;
    if (resumen) paper.extracto = truncate(resumen, 4000);
    const short = (u: string) => `openalex:${u.split("/").pop()}`;
    return { paper, resumen, referencias: (w.referenced_works ?? []).slice(0, 25).map(short), relacionados: (w.related_works ?? []).slice(0, 10).map(short) };
  } catch (err) {
    if (!doi || !(err instanceof SourceError) || !["not_found", "upstream_unavailable", "timeout", "network"].includes(err.code)) throw err;
    // Fallback to Crossref for DOIs OpenAlex does not know (or when OpenAlex is down).
    const { body } = await ctx.http.json<any>(`https://api.crossref.org/works/${encodeURIComponent(doi)}?${qs({ mailto: ctx.cfg.CONTACT_EMAIL })}`, {
      source: "crossref",
      hints: { 404: "El DOI no existe en Crossref ni en OpenAlex. Verifícalo en https://doi.org." },
    });
    const paper = fromCrossref(body.message);
    const resumen = body.message?.abstract ? stripTags(body.message.abstract) : undefined;
    if (resumen) paper.extracto = truncate(resumen, 4000);
    return { paper, resumen, referencias: (body.message?.reference ?? []).map((r: any) => (r.DOI ? `doi:${normalizeDoi(r.DOI)}` : r.unstructured)).filter(Boolean).slice(0, 25) };
  }
}
