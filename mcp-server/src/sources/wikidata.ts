import { SourceError } from "../errors.js";
import { makeEvidencia, type Evidencia } from "../evidence.js";
import { qs, type SourceContext } from "./context.js";

const API = "https://www.wikidata.org/w/api.php";

/** Properties worth surfacing by default (people, places, organizations, works, quantities). */
const DEFAULT_PROPS = [
  "P31", "P279", "P17", "P131", "P36", "P1082", "P2046", "P571", "P576", "P569", "P570", "P19", "P20", "P27",
  "P106", "P108", "P69", "P112", "P159", "P169", "P452", "P2139", "P1128", "P856", "P577", "P50", "P495",
  "P625", "P38", "P37", "P6", "P35", "P1813", "P154",
];

function renderValue(snak: any, labels: Record<string, string>): string | undefined {
  const dv = snak?.datavalue;
  if (!dv) return snak?.snaktype === "novalue" ? "(sin valor)" : undefined;
  const v = dv.value;
  switch (dv.type) {
    case "wikibase-entityid":
      return labels[v.id] ? `${labels[v.id]} (${v.id})` : v.id;
    case "time": {
      const t = String(v.time).replace(/^\+/, "");
      return v.precision >= 11 ? t.slice(0, 10) : v.precision === 10 ? t.slice(0, 7) : t.slice(0, t.indexOf("-", 1));
    }
    case "quantity": {
      const unit = String(v.unit ?? "");
      const unitId = unit.match(/Q\d+$/)?.[0];
      return `${String(v.amount).replace(/^\+/, "")}${unitId ? " " + (labels[unitId] ?? unitId) : ""}`;
    }
    case "monolingualtext":
      return v.text;
    case "globecoordinate":
      return `${v.latitude}, ${v.longitude}`;
    default:
      return typeof v === "string" ? v : JSON.stringify(v);
  }
}

export interface EntidadWikidata {
  entidad: Evidencia;
  propiedades: { propiedad: string; id: string; valores: { valor: string; fecha_referencia?: string; tiene_referencias: boolean }[] }[];
}

export async function consultarWikidata(
  ctx: SourceContext,
  p: { query?: string; id?: string; idioma?: string; propiedades?: string[]; max_resultados: number },
): Promise<{ entidades: EntidadWikidata[] }> {
  const lang = p.idioma ?? ctx.cfg.WIKIPEDIA_LANG;
  let ids: string[];
  if (p.id) ids = [p.id];
  else {
    const s = await ctx.http.json<any>(
      `${API}?${qs({ action: "wbsearchentities", search: p.query, language: lang, uselang: lang, type: "item", limit: p.max_resultados, format: "json" })}`,
      { source: "wikidata" },
    );
    ids = (s.body?.search ?? []).map((r: any) => r.id);
    if (!ids.length) return { entidades: [] };
  }

  const g = await ctx.http.json<any>(
    `${API}?${qs({ action: "wbgetentities", ids: ids.join("|"), languages: `${lang}|en`, props: "labels|descriptions|claims|sitelinks/urls|info", format: "json" })}`,
    { source: "wikidata" },
  );
  const entities: Record<string, any> = g.body?.entities ?? {};
  if (p.id && (!entities[p.id] || entities[p.id].missing !== undefined)) {
    throw new SourceError("not_found", `No existe la entidad ${p.id} en Wikidata.`, "Busca la entidad por nombre con el parámetro query.", false, "wikidata");
  }
  const wanted = p.propiedades?.length ? p.propiedades : DEFAULT_PROPS;

  // Collect referenced item ids (values, units, property ids) to resolve their labels in one batch.
  const refIds = new Set<string>(wanted);
  for (const e of Object.values(entities)) {
    for (const pid of wanted) {
      for (const c of e.claims?.[pid] ?? []) {
        const v = c.mainsnak?.datavalue?.value;
        if (v?.id) refIds.add(v.id);
        const unit = typeof v?.unit === "string" ? v.unit.match(/Q\d+$/)?.[0] : undefined;
        if (unit) refIds.add(unit);
      }
    }
  }
  const labels: Record<string, string> = {};
  const all = [...refIds];
  for (let i = 0; i < all.length; i += 50) {
    const chunk = all.slice(i, i + 50);
    const l = await ctx.http.json<any>(`${API}?${qs({ action: "wbgetentities", ids: chunk.join("|"), languages: `${lang}|en`, props: "labels", format: "json" })}`, { source: "wikidata" });
    for (const [id, ent] of Object.entries<any>(l.body?.entities ?? {})) {
      const lbl = ent.labels?.[lang]?.value ?? ent.labels?.en?.value;
      if (lbl) labels[id] = lbl;
    }
  }

  const entidades: EntidadWikidata[] = ids
    .map((id) => entities[id])
    .filter(Boolean)
    .map((e) => {
      const label = e.labels?.[lang]?.value ?? e.labels?.en?.value ?? e.id;
      const desc = e.descriptions?.[lang]?.value ?? e.descriptions?.en?.value ?? "";
      const propiedades = wanted
        .filter((pid) => e.claims?.[pid]?.length)
        .map((pid) => ({
          propiedad: labels[pid] ?? pid,
          id: pid,
          valores: (e.claims[pid] as any[])
            .filter((c) => c.rank !== "deprecated")
            .slice(0, 10)
            .map((c) => {
              const pit = c.qualifiers?.P585?.[0] ?? c.qualifiers?.P580?.[0];
              const fecha = pit ? renderValue(pit, labels) : undefined;
              return { valor: renderValue(c.mainsnak, labels) ?? "?", ...(fecha ? { fecha_referencia: fecha } : {}), tiene_referencias: (c.references?.length ?? 0) > 0 };
            }),
        }));
      return {
        entidad: makeEvidencia({
          id: `wikidata:${e.id}`,
          titulo: label,
          extracto: desc,
          url: `https://www.wikidata.org/wiki/${e.id}`,
          fuente: "wikidata",
          tipo: "dato_estructurado",
          fecha_actualizacion: e.modified,
          datos: e.sitelinks?.[`${lang}wiki`]?.url ? { wikipedia: e.sitelinks[`${lang}wiki`].url } : undefined,
        }),
        propiedades,
      };
    });
  return { entidades };
}
