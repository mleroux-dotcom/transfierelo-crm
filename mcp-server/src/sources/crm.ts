import { SourceError } from "../errors.js";
import { makeEvidencia, pagina, type Evidencia, type Pagina } from "../evidence.js";
import { truncate } from "../text.js";
import type { SourceContext } from "./context.js";

export const CRM_ENTITIES = ["contacts", "companies", "deals", "tasks"] as const;
export type CrmEntity = (typeof CRM_ENTITIES)[number];
export const CONTACT_STATUSES = ["lead", "cliente", "inactivo"] as const;
export const DEAL_STAGES = ["nuevo", "contactado", "propuesta", "negociacion", "ganado", "perdido"] as const;

const WEB_PATH: Record<CrmEntity, string> = { contacts: "contactos", companies: "empresas", deals: "oportunidades", tasks: "tareas" };
const LIST_TTL = 60_000;

type Row = Record<string, any>;

/** Local "today" (respects TZ), used for overdue tasks. */
export const today = (): string => new Date().toLocaleDateString("sv-SE");

export class CrmClient {
  constructor(private readonly ctx: SourceContext) {}

  private get base(): string {
    return this.ctx.cfg.CRM_BASE_URL!.replace(/\/$/, "");
  }

  private opts(extra: Partial<Parameters<SourceContext["http"]["json"]>[1]> = {}) {
    return {
      source: "crm",
      headers: { "x-api-key": this.ctx.cfg.CRM_API_KEY! },
      cacheScope: "crm",
      cacheTtlMs: LIST_TTL,
      hints: {
        401: "CRM_API_KEY no coincide con la clave del CRM. Revisa la variable de entorno.",
        404: "Ese registro no existe en el CRM. Búscalo primero con la tool crm_buscar_* correspondiente.",
        400: "El CRM rechazó los datos. Revisa campos obligatorios y formatos (fechas AAAA-MM-DD).",
      },
      ...extra,
    };
  }

  async list(entity: CrmEntity, params: Record<string, string | number | undefined> = {}): Promise<Row[]> {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
    const { body } = await this.ctx.http.json<{ data: Row[] }>(`${this.base}/api/${entity}${sp.size ? `?${sp}` : ""}`, this.opts());
    return body?.data ?? [];
  }

  async get(entity: CrmEntity, id: number): Promise<Row> {
    const { body } = await this.ctx.http.json<{ data: Row }>(`${this.base}/api/${entity}/${id}`, this.opts());
    if (!body?.data) throw new SourceError("not_found", `No existe ${entity} con id ${id}.`, "Búscalo con la tool crm_buscar_* correspondiente.", false, "crm");
    return body.data;
  }

  async getOptional(entity: CrmEntity, id?: number | null): Promise<Row | undefined> {
    if (!id) return undefined;
    try {
      return await this.get(entity, id);
    } catch (e) {
      if (e instanceof SourceError && e.code === "not_found") return undefined;
      throw e;
    }
  }

  async create(entity: CrmEntity, data: Row): Promise<Row> {
    const { body } = await this.ctx.http.json<{ data: Row }>(`${this.base}/api/${entity}`, this.opts({ method: "POST", body: data, cacheTtlMs: 0 }));
    this.invalidate();
    return body.data;
  }

  async update(entity: CrmEntity, id: number, data: Row): Promise<Row> {
    const { body } = await this.ctx.http.json<{ data: Row }>(`${this.base}/api/${entity}/${id}`, this.opts({ method: "PATCH", body: data, cacheTtlMs: 0 }));
    this.invalidate();
    return body.data;
  }

  invalidate(): void {
    this.ctx.http.cache.deleteWhere((k) => k.startsWith("crm|"));
  }

  evidencia(entity: CrmEntity, r: Row): Evidencia {
    const { titulo, extracto } = describe(entity, r);
    const { id, created_at, notes, ...rest } = r;
    return makeEvidencia({
      id: `crm:${entity}:${id}`,
      titulo,
      extracto,
      url: `${this.base}/${WEB_PATH[entity]}/${id}`,
      fuente: "crm transfiereloo",
      tipo: "crm",
      fecha_publicacion: created_at ? String(created_at).replace(" ", "T") + (String(created_at).includes("Z") ? "" : "Z") : undefined,
      datos: { id, ...rest, ...(notes ? { notas: truncate(String(notes), 1000) } : {}) },
    });
  }
}

function describe(entity: CrmEntity, r: Row): { titulo: string; extracto: string } {
  switch (entity) {
    case "contacts": {
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
      return { titulo: name, extracto: [r.position, r.email, r.phone, `estado: ${r.status}`].filter(Boolean).join(" · ") };
    }
    case "companies":
      return { titulo: r.name, extracto: [r.industry, r.website, r.phone].filter(Boolean).join(" · ") || "(sin datos)" };
    case "deals":
      return { titulo: r.title, extracto: `valor: ${r.value} · etapa: ${r.stage}${r.expected_close ? ` · cierre esperado: ${r.expected_close}` : ""}` };
    case "tasks": {
      const vencida = !r.done && r.due_date && r.due_date < today();
      return { titulo: r.title, extracto: `${r.done ? "hecha" : vencida ? "VENCIDA" : "pendiente"}${r.due_date ? ` · vence: ${r.due_date}` : ""}` };
    }
  }
}

/** Paginates an already-filtered list (the CRM API itself does not paginate). */
export function paginar(client: CrmClient, entity: CrmEntity, rows: Row[], p: { pagina: number; por_pagina: number }): Pagina {
  const start = (p.pagina - 1) * p.por_pagina;
  return pagina(
    rows.slice(start, start + p.por_pagina).map((r) => client.evidencia(entity, r)),
    { pagina: p.pagina, por_pagina: p.por_pagina, total: rows.length },
  );
}

export async function resumenPipeline(client: CrmClient) {
  const [deals, tasks, contacts, companies] = await Promise.all([client.list("deals"), client.list("tasks"), client.list("contacts"), client.list("companies")]);
  const hoy = today();
  const por_etapa = DEAL_STAGES.map((etapa) => {
    const ds = deals.filter((d) => d.stage === etapa);
    return { etapa, cantidad: ds.length, valor_total: ds.reduce((s, d) => s + Number(d.value || 0), 0) };
  });
  const abiertas = deals.filter((d) => !["ganado", "perdido"].includes(d.stage));
  const pendientes = tasks.filter((t) => !t.done);
  const vencidas = pendientes.filter((t) => t.due_date && t.due_date < hoy);
  return {
    fuente: "crm transfiereloo",
    consultado_en: new Date().toISOString(),
    fecha_referencia: hoy,
    contactos: { total: contacts.length, por_estado: Object.fromEntries(CONTACT_STATUSES.map((s) => [s, contacts.filter((c) => c.status === s).length])) },
    empresas: companies.length,
    oportunidades: {
      total: deals.length,
      abiertas: abiertas.length,
      valor_abierto: abiertas.reduce((s, d) => s + Number(d.value || 0), 0),
      valor_ganado: por_etapa.find((e) => e.etapa === "ganado")!.valor_total,
      por_etapa,
      cierres_proximos_30_dias: abiertas
        .filter((d) => d.expected_close && d.expected_close >= hoy && d.expected_close <= addDays(hoy, 30))
        .map((d) => ({ id: d.id, titulo: d.title, valor: d.value, etapa: d.stage, cierre: d.expected_close })),
    },
    tareas: {
      pendientes: pendientes.length,
      vencidas: vencidas.length,
      lista_vencidas: vencidas.slice(0, 20).map((t) => ({ id: t.id, titulo: t.title, vence: t.due_date })),
    },
  };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
