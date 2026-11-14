const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", copy: "©", reg: "®", deg: "°",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É",
  Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", iexcl: "¡", iquest: "¿",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export const stripTags = (s: string): string => decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.8 ? cut.slice(0, sp) : cut) + "…";
}

export interface HtmlExtract {
  titulo: string;
  descripcion?: string;
  fecha_publicacion?: string;
  fecha_actualizacion?: string;
  autor?: string;
  idioma?: string;
  texto: string;
}

function meta(html: string, names: string[]): string | undefined {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:name|property|itemprop)=["']${n}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property|itemprop)=["']${n}["']`, "i");
    const m = html.match(re1) ?? html.match(re2);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return undefined;
}

/** Readable-text extraction good enough for grounding: drops chrome (nav/footer/scripts), keeps paragraphs. */
export function htmlToText(html: string): HtmlExtract {
  const titulo = meta(html, ["og:title", "twitter:title"]) ?? stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const descripcion = meta(html, ["description", "og:description"]);
  const fecha_publicacion =
    meta(html, ["article:published_time", "datePublished", "date", "dc.date", "citation_publication_date", "pubdate"]) ??
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  const fecha_actualizacion = meta(html, ["article:modified_time", "dateModified", "og:updated_time", "last-modified"]);
  const autor = meta(html, ["author", "article:author", "citation_author"]);
  const idioma = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1];

  let body = html.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|li|h[1-6]|tr|blockquote|pre|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  const texto = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { titulo, descripcion, fecha_publicacion, fecha_actualizacion, autor, idioma, texto };
}

/** Normalizes a DOI or DOI URL to lowercase bare form ("10.xxx/yyy"). */
export function normalizeDoi(s?: string | null): string | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/10\.\d{4,9}\/\S+/i);
  return m ? m[0].replace(/[.,;]+$/, "").toLowerCase() : undefined;
}

export function normalizeUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    url.hash = "";
    for (const p of [...url.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/.test(p)) url.searchParams.delete(p);
    return (url.host.replace(/^www\./, "") + url.pathname.replace(/\/$/, "") + (url.search || "")).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

export function toIsoDate(s?: string | null): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

/** Simple tokenizer for BM25 / overlap scoring: lowercase, strip accents, drop short tokens and stopwords. */
const STOP = new Set(
  "el la los las un una unos unas de del al y o u en a por para con sin sobre que se su sus es son fue ser como mas más pero lo le les the of and or to in on for with a an is are was were be by at from as that this it its".split(" "),
);
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Prefix stemming (first 5 chars): crude but robust for Spanish/English retrieval ("devolución" ≈ "devolver"). */
export const stem = (t: string): string => (t.length > 5 && !/^\d+$/.test(t) ? t.slice(0, 5) : t);
export const stemTokens = (s: string): string[] => tokenize(s).map(stem);
