import { SourceError } from "../errors.js";
import { makeEvidencia, pagina, type Evidencia, type Pagina } from "../evidence.js";
import { stripTags, truncate } from "../text.js";
import { qs, type SourceContext } from "./context.js";

const api = (lang: string) => `https://${lang}.wikipedia.org/w/api.php`;

export async function buscarWikipedia(
  ctx: SourceContext,
  p: { query: string; idioma?: string; pagina: number; por_pagina: number },
): Promise<Pagina> {
  const lang = p.idioma ?? ctx.cfg.WIKIPEDIA_LANG;
  const url = `${api(lang)}?${qs({
    action: "query",
    list: "search",
    srsearch: p.query,
    srlimit: p.por_pagina,
    sroffset: (p.pagina - 1) * p.por_pagina,
    srprop: "snippet|timestamp",
    format: "json",
    formatversion: 2,
    utf8: 1,
  })}`;
  const { body } = await ctx.http.json<any>(url, { source: "wikipedia" });
  const hits: any[] = body?.query?.search ?? [];
  const total: number | undefined = body?.query?.searchinfo?.totalhits;
  const resultados = hits.map((h) =>
    makeEvidencia({
      id: `wikipedia:${lang}:${h.title}`,
      titulo: h.title,
      extracto: stripTags(h.snippet ?? ""),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, "_"))}`,
      fuente: `wikipedia (${lang})`,
      tipo: "enciclopedia",
      fecha_actualizacion: h.timestamp,
    }),
  );
  const avisos = !resultados.length && lang !== "en" ? [`Sin resultados en ${lang}.wikipedia; prueba idioma "en".`] : undefined;
  return pagina(resultados, { pagina: p.pagina, por_pagina: p.por_pagina, total, hay_mas: !!body?.continue, avisos });
}

export interface ArticuloWikipedia {
  articulo: Evidencia;
  texto: string;
  desde_caracter: number;
  total_caracteres: number;
  siguiente_caracter?: number;
}

export async function obtenerArticuloWikipedia(
  ctx: SourceContext,
  p: { titulo: string; idioma?: string; desde_caracter: number; max_caracteres: number },
): Promise<ArticuloWikipedia> {
  const lang = p.idioma ?? ctx.cfg.WIKIPEDIA_LANG;
  const url = `${api(lang)}?${qs({
    action: "query",
    prop: "extracts|info|revisions",
    explaintext: 1,
    inprop: "url",
    rvprop: "timestamp",
    redirects: 1,
    titles: p.titulo,
    format: "json",
    formatversion: 2,
    utf8: 1,
  })}`;
  const { body } = await ctx.http.json<any>(url, { source: "wikipedia" });
  const page = body?.query?.pages?.[0];
  if (!page || page.missing || page.invalid) {
    throw new SourceError("not_found", `No existe el artículo "${p.titulo}" en ${lang}.wikipedia.`, "Usa buscar_wikipedia para obtener el título exacto, o prueba otro idioma.", false, "wikipedia");
  }
  const full: string = page.extract ?? "";
  const texto = full.slice(p.desde_caracter, p.desde_caracter + p.max_caracteres);
  const end = p.desde_caracter + texto.length;
  const articulo = makeEvidencia({
    id: `wikipedia:${lang}:${page.title}`,
    titulo: page.title,
    extracto: truncate(full.split("\n").find((l) => l.trim().length > 40) ?? full, 500),
    url: page.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    fuente: `wikipedia (${lang})`,
    tipo: "enciclopedia",
    fecha_actualizacion: page.revisions?.[0]?.timestamp ?? page.touched,
  });
  return { articulo, texto, desde_caracter: p.desde_caracter, total_caracteres: full.length, ...(end < full.length ? { siguiente_caracter: end } : {}) };
}

/** One-call search returning intro extracts (better grounding than search snippets). Used by investigar. */
export async function resumenesWikipedia(ctx: SourceContext, query: string, n: number, idioma?: string): Promise<Evidencia[]> {
  const lang = idioma ?? ctx.cfg.WIKIPEDIA_LANG;
  const url = `${api(lang)}?${qs({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: n,
    prop: "extracts|info|revisions",
    exintro: 1,
    explaintext: 1,
    exlimit: n,
    inprop: "url",
    rvprop: "timestamp",
    format: "json",
    formatversion: 2,
    utf8: 1,
  })}`;
  const { body } = await ctx.http.json<any>(url, { source: "wikipedia" });
  const pages: any[] = [...(body?.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.map((pg) =>
    makeEvidencia({
      id: `wikipedia:${lang}:${pg.title}`,
      titulo: pg.title,
      extracto: truncate(pg.extract ?? "", 700),
      url: pg.fullurl,
      fuente: `wikipedia (${lang})`,
      tipo: "enciclopedia",
      fecha_actualizacion: pg.revisions?.[0]?.timestamp ?? pg.touched,
    }),
  );
}
