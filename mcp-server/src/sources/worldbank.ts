import { SourceError } from "../errors.js";
import { makeEvidencia, type Evidencia } from "../evidence.js";
import { tokenize, truncate } from "../text.js";
import { qs, type SourceContext } from "./context.js";

const API = "https://api.worldbank.org/v2";
const DAY = 24 * 3600 * 1000;

export interface SerieBancoMundial {
  serie: Evidencia;
  valores: { anio: string; valor: number | null }[];
  ultima_actualizacion?: string;
}

export async function datosBancoMundial(
  ctx: SourceContext,
  p: { indicador: string; paises: string[]; desde_anio?: number; hasta_anio?: number },
): Promise<{ series: SerieBancoMundial[] }> {
  const date = p.desde_anio || p.hasta_anio ? `${p.desde_anio ?? 1960}:${p.hasta_anio ?? new Date().getFullYear()}` : undefined;
  const url = `${API}/country/${p.paises.map(encodeURIComponent).join(";")}/indicator/${encodeURIComponent(p.indicador)}?${qs({ format: "json", per_page: 2000, date })}`;
  const { body } = await ctx.http.json<any>(url, { source: "worldbank", cacheTtlMs: 6 * 3600 * 1000 });
  if (!Array.isArray(body) || body[0]?.message) {
    const msg = body?.[0]?.message?.[0]?.value ?? "respuesta inesperada";
    throw new SourceError("invalid_input", `Banco Mundial rechazó la consulta: ${msg}`, "Verifica el código del indicador con buscar_indicador_banco_mundial y usa códigos ISO de país (CL, ARG, MEX) o agregados (WLD, LCN).", false, "worldbank");
  }
  const meta = body[0];
  const rows: any[] = body[1] ?? [];
  if (!rows.length) {
    throw new SourceError("not_found", "El Banco Mundial no tiene datos para esa combinación de indicador, país y años.", "Amplía el rango de años o revisa el indicador y los países.", false, "worldbank");
  }
  const byCountry = new Map<string, any[]>();
  for (const r of rows) {
    const k = r.countryiso3code || r.country?.id;
    byCountry.set(k, [...(byCountry.get(k) ?? []), r]);
  }
  const series = [...byCountry.values()].map((rs) => {
    const first = rs[0];
    const valores = rs.map((r) => ({ anio: String(r.date), valor: r.value as number | null })).sort((a, b) => a.anio.localeCompare(b.anio));
    const ultimo = [...valores].reverse().find((v) => v.valor !== null);
    return {
      serie: makeEvidencia({
        id: `worldbank:${first.indicator?.id}:${first.countryiso3code || first.country?.id}`,
        titulo: `${first.indicator?.value} — ${first.country?.value}`,
        extracto: ultimo ? `Último dato disponible: ${ultimo.valor} (${ultimo.anio})${first.unit ? " " + first.unit : ""}` : "Sin valores en el rango pedido",
        url: `https://data.worldbank.org/indicator/${first.indicator?.id}?locations=${first.country?.id}`,
        fuente: "banco_mundial",
        tipo: "estadistica_oficial",
        fecha_actualizacion: meta?.lastupdated,
      }),
      valores,
      ultima_actualizacion: meta?.lastupdated,
    };
  });
  return { series };
}

/** Searches the World Development Indicators catalogue (cached 24 h) by keyword. */
export async function buscarIndicadorBancoMundial(ctx: SourceContext, p: { query: string; max_resultados: number }): Promise<{ indicadores: { codigo: string; nombre: string; descripcion: string; fuente_original?: string }[] }> {
  const { body } = await ctx.http.json<any>(`${API}/indicator?${qs({ format: "json", source: 2, per_page: 3000 })}`, { source: "worldbank", cacheTtlMs: DAY });
  const all: any[] = body?.[1] ?? [];
  const q = tokenize(p.query);
  const code = p.query.trim().toUpperCase();
  const scored = all
    .map((ind) => {
      if (ind.id === code) return { ind, score: 1000 };
      const name = tokenize(ind.name ?? "");
      const note = tokenize(ind.sourceNote ?? "");
      let score = 0;
      for (const t of q) {
        if (name.includes(t)) score += 3;
        else if (name.some((n) => n.startsWith(t))) score += 2;
        if (note.includes(t)) score += 1;
      }
      return { ind, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, p.max_resultados);
  return {
    indicadores: scored.map(({ ind }) => ({ codigo: ind.id, nombre: ind.name, descripcion: truncate(ind.sourceNote ?? "", 300), fuente_original: ind.sourceOrganization || undefined })),
  };
}
