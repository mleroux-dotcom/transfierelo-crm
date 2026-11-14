import { z } from "zod";

export const FIABILIDAD = ["alta", "media", "baja"] as const;
export type Fiabilidad = (typeof FIABILIDAD)[number];

export const TIPOS = ["enciclopedia", "dato_estructurado", "paper", "preprint", "estadistica_oficial", "codigo", "web", "noticia", "documento", "crm"] as const;
export type TipoEvidencia = (typeof TIPOS)[number];

/** One piece of verifiable information. Every tool result is built from these. */
export const EvidenciaSchema = z.object({
  id: z.string().describe("Identificador estable: <fuente>:<id>. Úsalo con la tool obtener_* correspondiente."),
  titulo: z.string(),
  extracto: z.string().describe("Texto literal de la fuente (puede estar recortado)."),
  url: z.string().optional(),
  fuente: z.string(),
  tipo: z.enum(TIPOS),
  autores: z.array(z.string()).optional(),
  fecha_publicacion: z.string().optional(),
  fecha_actualizacion: z.string().optional(),
  consultado_en: z.string(),
  fiabilidad: z.enum(FIABILIDAD),
  motivo_fiabilidad: z.string(),
  datos: z.record(z.string(), z.unknown()).optional().describe("Campos extra específicos de la fuente."),
});
export type Evidencia = z.infer<typeof EvidenciaSchema>;

export const PaginaSchema = z.object({
  resultados: z.array(EvidenciaSchema),
  pagina: z.number().int(),
  por_pagina: z.number().int(),
  hay_mas: z.boolean(),
  total: z.number().int().optional(),
  consultado_en: z.string(),
  avisos: z.array(z.string()).optional(),
});
export type Pagina = z.infer<typeof PaginaSchema>;

export const nowIso = (): string => new Date().toISOString();

const PEER_REVIEWED_TYPES = new Set(["article", "journal-article", "review", "book-chapter", "book", "proceedings-article"]);

export interface FiabilidadInput {
  tipo: TipoEvidencia;
  revisado_por_pares?: boolean;
  citas?: number;
  retractado?: boolean;
  dominio?: string;
  estrellas?: number;
  archivado?: boolean;
}

/**
 * Deterministic, documented reliability rule. It does not judge truth, only provenance:
 *  - alta: peer-reviewed with DOI, official statistics, curated structured data, own documents, the CRM (system of record),
 *          government/academic domains.
 *  - media: encyclopedias, preprints, popular/maintained repos, news, general web from known publishers.
 *  - baja: anything else, retracted papers, archived/abandoned repos.
 */
export function evaluarFiabilidad(i: FiabilidadInput): { fiabilidad: Fiabilidad; motivo: string } {
  if (i.retractado) return { fiabilidad: "baja", motivo: "artículo retractado" };
  switch (i.tipo) {
    case "estadistica_oficial":
      return { fiabilidad: "alta", motivo: "estadística oficial de organismo internacional" };
    case "documento":
      return { fiabilidad: "alta", motivo: "documento propio del usuario" };
    case "crm":
      return { fiabilidad: "alta", motivo: "registro del CRM (sistema de referencia)" };
    case "dato_estructurado":
      return { fiabilidad: "media", motivo: "dato colaborativo de Wikidata; verifica sus referencias" };
    case "paper": {
      const citas = i.citas ?? 0;
      if (i.revisado_por_pares) return { fiabilidad: "alta", motivo: `publicación revisada por pares${citas ? `, ${citas} citas` : ""}` };
      return { fiabilidad: "media", motivo: `publicación académica sin revisión por pares confirmada${citas ? `, ${citas} citas` : ""}` };
    }
    case "preprint":
      return { fiabilidad: "media", motivo: "preprint: aún sin revisión por pares" };
    case "enciclopedia":
      return { fiabilidad: "media", motivo: "enciclopedia colaborativa; contrasta con sus referencias" };
    case "codigo": {
      if (i.archivado) return { fiabilidad: "baja", motivo: "repositorio archivado (sin mantenimiento)" };
      if (i.estrellas === undefined) return { fiabilidad: "baja", motivo: "contenido de GitHub sin evaluar la adopción del repositorio; verifica en el repositorio" };
      const s = i.estrellas;
      return s >= 100 ? { fiabilidad: "media", motivo: `repositorio con ${s} estrellas` } : { fiabilidad: "baja", motivo: `repositorio poco adoptado (${s} estrellas)` };
    }
    case "noticia":
    case "web": {
      const d = (i.dominio ?? "").toLowerCase();
      if (/\.(gov|gob|gouv|mil|int)(\.[a-z]{2})?$/.test(d) || /\.(edu|ac)(\.[a-z]{2})?$/.test(d) || d.endsWith(".europa.eu") || /\b(who\.int|un\.org|oecd\.org|worldbank\.org|imf\.org)$/.test(d)) {
        return { fiabilidad: "alta", motivo: `dominio institucional (${d})` };
      }
      return i.tipo === "noticia" ? { fiabilidad: "media", motivo: `medio/feed ${d}` } : { fiabilidad: "baja", motivo: `sitio web general (${d}); verifica con otra fuente` };
    }
  }
}

export const isPeerReviewedType = (t?: string | null): boolean => !!t && PEER_REVIEWED_TYPES.has(t);

export function makeEvidencia(e: Omit<Evidencia, "consultado_en" | "fiabilidad" | "motivo_fiabilidad"> & { fiab?: FiabilidadInput }): Evidencia {
  const { fiab, ...rest } = e;
  const f = evaluarFiabilidad(fiab ?? { tipo: e.tipo });
  const out: Evidencia = { ...rest, consultado_en: nowIso(), fiabilidad: f.fiabilidad, motivo_fiabilidad: f.motivo };
  for (const k of Object.keys(out) as (keyof Evidencia)[]) if (out[k] === undefined || out[k] === "") delete out[k];
  return out;
}

export function pagina(resultados: Evidencia[], p: { pagina: number; por_pagina: number; total?: number; hay_mas?: boolean; avisos?: string[] }): Pagina {
  const hay_mas = p.hay_mas ?? (p.total !== undefined ? p.pagina * p.por_pagina < p.total : resultados.length >= p.por_pagina);
  const out: Pagina = { resultados, pagina: p.pagina, por_pagina: p.por_pagina, hay_mas, consultado_en: nowIso() };
  if (p.total !== undefined) out.total = p.total;
  if (p.avisos?.length) out.avisos = p.avisos;
  return out;
}
