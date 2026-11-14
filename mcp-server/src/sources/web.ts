import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { XMLParser } from "fast-xml-parser";
import { SourceError } from "../errors.js";
import { makeEvidencia, pagina, type Evidencia, type Pagina } from "../evidence.js";
import { htmlToText, stripTags, toIsoDate, truncate } from "../text.js";
import { extractDocx, extractPdf } from "./extract.js";
import { qs, type SourceContext } from "./context.js";

// ---------- SSRF protection ----------

function isPrivateIPv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** Builds a guard that blocks non-http(s) URLs and hosts resolving to private/internal addresses. */
export function makeUrlGuard(allowPrivate: boolean, resolve: Resolver = defaultResolver) {
  return async (url: URL): Promise<void> => {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new SourceError("blocked_url", `Protocolo no permitido: ${url.protocol}`, "Solo se aceptan URLs http:// o https://.", false, "web");
    }
    if (url.username || url.password) throw new SourceError("blocked_url", "Las URLs con credenciales no están permitidas.", "Quita usuario:clave de la URL.", false, "web");
    if (allowPrivate) return;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const blockedName = host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/i.test(host) || host === "metadata.google.internal";
    const hint = "Por seguridad no se leen direcciones internas o privadas. Si es intencional (uso local), define ALLOW_PRIVATE_URLS=true.";
    if (blockedName) throw new SourceError("blocked_url", `Host interno bloqueado: ${host}`, hint, false, "web");
    if (isIP(host)) {
      if (isPrivateIp(host)) throw new SourceError("blocked_url", `IP privada bloqueada: ${host}`, hint, false, "web");
      return;
    }
    let addrs: string[] = [];
    try {
      addrs = await resolve(host);
    } catch (err) {
      // Behind an egress proxy the local resolver may not know public names; the proxy resolves them instead.
      if (process.env.HTTPS_PROXY || process.env.https_proxy) return;
      throw new SourceError("not_found", `No se pudo resolver el dominio ${host}.`, "Verifica que la URL esté bien escrita.", false, "web");
    }
    const bad = addrs.find(isPrivateIp);
    if (bad) throw new SourceError("blocked_url", `${host} apunta a una IP privada (${bad}).`, hint, false, "web");
  };
}

// ---------- Read any URL ----------

export interface LecturaUrl {
  documento: Evidencia;
  formato: string;
  texto: string;
  desde_caracter: number;
  total_caracteres: number;
  siguiente_caracter?: number;
}

export async function leerUrl(ctx: SourceContext, p: { url: string; desde_caracter: number; max_caracteres: number }, guard = makeUrlGuard(ctx.cfg.ALLOW_PRIVATE_URLS)): Promise<LecturaUrl> {
  let parsed: URL;
  try {
    parsed = new URL(p.url);
  } catch {
    throw new SourceError("invalid_input", `URL inválida: ${p.url}`, "Incluye el protocolo, por ejemplo https://ejemplo.com/pagina.", false, "web");
  }
  const res = await ctx.http.request<Buffer>(parsed.toString(), {
    source: "web",
    responseType: "bytes",
    guardUrl: guard,
    headers: { accept: "text/html,application/xhtml+xml,application/pdf,application/json,text/plain;q=0.9,*/*;q=0.5" },
    maxBytes: ctx.cfg.MAX_DOWNLOAD_MB * 1e6,
  });
  const ct = res.contentType.toLowerCase();
  const buf = res.body;
  const finalUrl = new URL(res.url);
  let titulo = finalUrl.toString();
  let texto: string;
  let formato: string;
  let fecha_publicacion: string | undefined;
  let fecha_actualizacion = toIsoDate(res.headers["last-modified"]);
  let autores: string[] | undefined;
  let descripcion: string | undefined;

  const isPdf = ct.includes("application/pdf") || buf.subarray(0, 5).toString() === "%PDF-";
  if (isPdf) {
    const pdf = await extractPdf(buf);
    formato = "pdf";
    texto = pdf.paginas.map((t, i) => `[página ${i + 1}]\n${t}`).join("\n\n");
    titulo = pdf.titulo || decodeURIComponent(finalUrl.pathname.split("/").pop() || titulo);
    fecha_publicacion = pdf.fecha;
  } else if (ct.includes("officedocument.wordprocessingml")) {
    formato = "docx";
    texto = await extractDocx(buf);
    titulo = decodeURIComponent(finalUrl.pathname.split("/").pop() || titulo);
  } else if (ct.includes("json")) {
    formato = "json";
    const raw = buf.toString("utf8");
    try {
      texto = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      texto = raw;
    }
  } else if (ct.includes("html") || ct.includes("xml") || /^\s*</.test(buf.subarray(0, 200).toString("utf8"))) {
    formato = "html";
    const h = htmlToText(buf.toString("utf8"));
    titulo = h.titulo || titulo;
    texto = h.texto;
    descripcion = h.descripcion;
    fecha_publicacion = toIsoDate(h.fecha_publicacion);
    fecha_actualizacion = toIsoDate(h.fecha_actualizacion) ?? fecha_actualizacion;
    autores = h.autor ? [h.autor] : undefined;
  } else if (ct.startsWith("text/") || ct === "") {
    formato = "texto";
    texto = buf.toString("utf8");
  } else {
    throw new SourceError("unsupported", `Formato no soportado: ${ct}`, "Se leen HTML, PDF, DOCX, JSON y texto. Busca una versión en uno de esos formatos.", false, "web");
  }

  const chunk = texto.slice(p.desde_caracter, p.desde_caracter + p.max_caracteres);
  const end = p.desde_caracter + chunk.length;
  return {
    documento: makeEvidencia({
      id: `web:${finalUrl.toString()}`,
      titulo,
      extracto: truncate(descripcion || texto, 400),
      url: finalUrl.toString(),
      fuente: `web (${finalUrl.hostname})`,
      tipo: "web",
      autores,
      fecha_publicacion,
      fecha_actualizacion,
      fiab: { tipo: "web", dominio: finalUrl.hostname },
    }),
    formato,
    texto: chunk,
    desde_caracter: p.desde_caracter,
    total_caracteres: texto.length,
    ...(end < texto.length ? { siguiente_caracter: end } : {}),
  };
}

// ---------- Web search (Brave Search API or self-hosted SearXNG) ----------

export async function buscarWeb(ctx: SourceContext, p: { query: string; pagina: number; por_pagina: number; recientes?: "dia" | "semana" | "mes" | "anio" }): Promise<Pagina> {
  if (ctx.cfg.BRAVE_API_KEY) {
    const freshness = p.recientes ? { dia: "pd", semana: "pw", mes: "pm", anio: "py" }[p.recientes] : undefined;
    const { body } = await ctx.http.json<any>(`https://api.search.brave.com/res/v1/web/search?${qs({ q: p.query, count: p.por_pagina, offset: p.pagina - 1, freshness })}`, {
      source: "brave",
      headers: { "x-subscription-token": ctx.cfg.BRAVE_API_KEY },
      cacheScope: "brave",
      hints: { 401: "BRAVE_API_KEY inválida.", 422: "Brave solo permite hasta 10 páginas y 20 resultados por página." },
    });
    const items = (body?.web?.results ?? []).map((r: any) => webEvidencia(r.url, r.title, r.description, r.page_age, "brave"));
    return pagina(items, { pagina: p.pagina, por_pagina: p.por_pagina, hay_mas: !!body?.query?.more_results_available });
  }
  if (ctx.cfg.SEARXNG_URL) {
    const time_range = p.recientes ? { dia: "day", semana: "week", mes: "month", anio: "year" }[p.recientes] : undefined;
    const { body } = await ctx.http.json<any>(`${ctx.cfg.SEARXNG_URL.replace(/\/$/, "")}/search?${qs({ q: p.query, format: "json", pageno: p.pagina, time_range })}`, {
      source: "searxng",
      hints: { 403: "Tu instancia SearXNG no tiene habilitado format=json (search.formats en settings.yml)." },
    });
    const items = (body?.results ?? []).slice(0, p.por_pagina).map((r: any) => webEvidencia(r.url, r.title, r.content, r.publishedDate, `searxng/${r.engine ?? "?"}`));
    return pagina(items, { pagina: p.pagina, por_pagina: p.por_pagina, hay_mas: (body?.results ?? []).length > 0 });
  }
  throw new SourceError("source_disabled", "No hay buscador web configurado.", "Define BRAVE_API_KEY (https://brave.com/search/api) o SEARXNG_URL. Mientras tanto usa las fuentes académicas, Wikipedia o leer_url con una URL conocida.", false, "busqueda_web");
}

function webEvidencia(url: string, title: string, desc: string | undefined, date: string | undefined, motor: string): Evidencia {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  return makeEvidencia({
    id: `web:${url}`,
    titulo: stripTags(title ?? url),
    extracto: truncate(stripTags(desc ?? ""), 400) || "(sin descripción; usa leer_url para leer la página)",
    url,
    fuente: `web (${host})`,
    tipo: "web",
    fecha_publicacion: toIsoDate(date),
    datos: { buscador: motor },
    fiab: { tipo: "web", dominio: host },
  });
}

// ---------- RSS / Atom ----------

const feedXml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", isArray: (n) => ["item", "entry", "link", "category"].includes(n) });
const txt = (v: any): string => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));

export async function leerFeed(ctx: SourceContext, p: { url: string; max_items: number; pagina: number }, guard = makeUrlGuard(ctx.cfg.ALLOW_PRIVATE_URLS)): Promise<Pagina & { feed: { titulo: string; url: string; actualizado?: string } }> {
  const res = await ctx.http.text(p.url, { source: "feeds", guardUrl: guard, cacheTtlMs: 10 * 60 * 1000, headers: { accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9" } });
  let doc: any;
  try {
    doc = feedXml.parse(res.body);
  } catch {
    doc = undefined;
  }
  const rss = doc?.rss?.channel ?? doc?.["rdf:RDF"]?.channel;
  const atom = doc?.feed;
  if (!rss && !atom) throw new SourceError("unsupported", "La URL no es un feed RSS o Atom válido.", "Busca el enlace RSS/Atom del sitio (suele estar en /feed, /rss o /atom.xml) o usa leer_url.", false, "feeds");
  let host = "";
  try {
    host = new URL(res.url).hostname;
  } catch {}
  const rawItems: any[] = rss ? (rss.item ?? doc?.["rdf:RDF"]?.item ?? []) : (atom.entry ?? []);
  const all = rawItems.map((it) => {
    const link = rss ? txt(it.link?.[0] ?? it.link) || txt(it.guid) : (it.link ?? []).find((l: any) => !l["@rel"] || l["@rel"] === "alternate")?.["@href"] ?? it.link?.[0]?.["@href"];
    const summary = rss ? txt(it.description) || txt(it["content:encoded"]) : txt(it.summary) || txt(it.content);
    const date = rss ? txt(it.pubDate) || txt(it["dc:date"]) : txt(it.published) || txt(it.updated);
    const author = rss ? txt(it["dc:creator"]) || txt(it.author) : txt(it.author?.name);
    return makeEvidencia({
      id: `feed:${link || txt(it.title)}`,
      titulo: stripTags(txt(it.title)),
      extracto: truncate(stripTags(summary), 500),
      url: link || undefined,
      fuente: `feed (${host})`,
      tipo: "noticia",
      autores: author ? [author] : undefined,
      fecha_publicacion: toIsoDate(date),
      fiab: { tipo: "noticia", dominio: host },
    });
  });
  const start = (p.pagina - 1) * p.max_items;
  const page = pagina(all.slice(start, start + p.max_items), { pagina: p.pagina, por_pagina: p.max_items, total: all.length });
  return {
    ...page,
    feed: {
      titulo: stripTags(txt(rss?.title ?? atom?.title)),
      url: res.url,
      actualizado: toIsoDate(txt(rss?.lastBuildDate) || txt(atom?.updated)) || undefined,
    },
  };
}
