import { describe, expect, it } from "vitest";
import { today } from "../src/sources/crm.js";
import { setup, type Reply, type Route } from "./helpers.js";

const BASE = "https://crm.example.cl";
const ENV = { CRM_BASE_URL: BASE, CRM_API_KEY: "clave-crm" };

function addDays(n: number) {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** In-memory imitation of the CRM REST API (same routes, filters and validation semantics). */
function fakeCrm() {
  const db: Record<string, any[]> = {
    companies: [{ id: 1, name: "Acme S.L.", industry: "Industria", website: "https://acme.example", created_at: "2026-10-01 10:00:00" }],
    contacts: [
      { id: 1, first_name: "Laura", last_name: "Gómez", email: "laura@acme.example", status: "cliente", company_id: 1, created_at: "2026-10-01 10:00:00" },
      { id: 2, first_name: "Carlos", last_name: "Ruiz", email: "carlos@globex.example", status: "lead", company_id: null, created_at: "2026-10-02 10:00:00" },
    ],
    deals: [
      { id: 1, title: "Renovación anual Acme", value: 12000, stage: "negociacion", contact_id: 1, company_id: 1, expected_close: addDays(10), created_at: "2026-10-01 10:00:00" },
      { id: 2, title: "Piloto Globex", value: 4500, stage: "propuesta", contact_id: 2, company_id: null, expected_close: addDays(60), created_at: "2026-10-01 10:00:00" },
      { id: 3, title: "Venta cerrada", value: 3000, stage: "ganado", contact_id: 1, company_id: 1, created_at: "2026-09-01 10:00:00" },
    ],
    tasks: [
      { id: 1, title: "Llamar a Laura", due_date: addDays(-2), done: 0, contact_id: 1, deal_id: 1, created_at: "2026-10-01 10:00:00" },
      { id: 2, title: "Enviar propuesta", due_date: addDays(5), done: 0, contact_id: 2, deal_id: 2, created_at: "2026-10-01 10:00:00" },
      { id: 3, title: "Kickoff", due_date: addDays(-30), done: 1, contact_id: 1, deal_id: 3, created_at: "2026-09-01 10:00:00" },
    ],
  };
  const searchable: Record<string, string[]> = { companies: ["name", "industry"], contacts: ["first_name", "last_name", "email", "phone"], deals: ["title"], tasks: ["title"] };
  const writes: { method: string; url: string; body: any }[] = [];

  const handler = (url: string, init?: RequestInit): Reply => {
    if ((init?.headers as Record<string, string>)["x-api-key"] !== "clave-crm") return { status: 401, body: { error: "No autorizado" } };
    const u = new URL(url);
    const [, , entity, idStr] = u.pathname.split("/");
    const rows = db[entity!];
    if (!rows) return { status: 404, body: { error: "Recurso desconocido" } };
    const method = init?.method ?? "GET";
    if (idStr) {
      const row = rows.find((r) => r.id === Number(idStr));
      if (!row) return { status: 404, body: { error: "No encontrado" } };
      if (method === "PATCH") {
        const body = JSON.parse(String(init!.body));
        writes.push({ method, url, body });
        Object.assign(row, body, body.done !== undefined ? { done: body.done ? 1 : 0 } : {});
      }
      return { body: { data: row } };
    }
    if (method === "POST") {
      const body = JSON.parse(String(init!.body));
      writes.push({ method, url, body });
      const row = { id: rows.length + 1, ...body, created_at: "2026-11-14 12:00:00" };
      rows.push(row);
      return { status: 201, body: { data: row } };
    }
    const q = u.searchParams.get("q");
    let out = rows.filter((r) => !q || searchable[entity!]!.some((c) => String(r[c] ?? "").toLowerCase().includes(q.toLowerCase())));
    for (const [k, v] of u.searchParams) if (k !== "q") out = out.filter((r) => String(r[k]) === v);
    return { body: { data: out } };
  };
  const routes: Route[] = [[new RegExp(`^${BASE}/api/`), handler]];
  return { db, routes, writes };
}

describe("CRM: lectura", () => {
  it("buscar y obtener contactos con relaciones, fuente y fecha", async () => {
    const crm = fakeCrm();
    const t = await setup(ENV, crm.routes);
    const r = await t.call("crm_buscar_contactos", { estado: "cliente" });
    expect(r.data.resultados).toHaveLength(1);
    expect(r.data.resultados[0]).toMatchObject({ id: "crm:contacts:1", titulo: "Laura Gómez", fuente: "crm transfiereloo", fiabilidad: "alta", url: `${BASE}/contactos/1`, fecha_publicacion: "2026-10-01T10:00:00Z" });
    expect(t.calls[0]!.url).toBe(`${BASE}/api/contacts?status=cliente`);

    const c = await t.call("crm_obtener_contacto", { id: 1 });
    expect(c.data.empresa.titulo).toBe("Acme S.L.");
    expect(c.data.oportunidades.map((o: any) => o.id)).toEqual(["crm:deals:1", "crm:deals:3"]);
    expect(c.data.tareas).toHaveLength(2);

    const missing = await t.call("crm_obtener_contacto", { id: 99 });
    expect(missing.text).toMatch(/not_found[\s\S]*crm_buscar/);
    await t.close();
  });

  it("empresas, oportunidades con filtros en el servidor MCP y paginación", async () => {
    const crm = fakeCrm();
    const t = await setup(ENV, crm.routes);
    expect((await t.call("crm_buscar_empresas", { industria: "indus" })).data.total).toBe(1);
    const e = await t.call("crm_obtener_empresa", { id: 1 });
    expect(e.data.contactos).toHaveLength(1);
    const ops = await t.call("crm_buscar_oportunidades", { valor_min: 4000, cierre_hasta: addDays(30) });
    expect(ops.data.resultados.map((x: any) => x.titulo)).toEqual(["Renovación anual Acme"]);
    const page2 = await t.call("crm_buscar_oportunidades", { por_pagina: 2, pagina: 2 });
    expect(page2.data).toMatchObject({ total: 3, pagina: 2, hay_mas: false });
    expect(page2.data.resultados).toHaveLength(1);
    const op = await t.call("crm_obtener_oportunidad", { id: 2 });
    expect(op.data).toMatchObject({ contacto: { titulo: "Carlos Ruiz" }, empresa: null });
    await t.close();
  });

  it("tareas vencidas y resumen del pipeline calculado", async () => {
    const crm = fakeCrm();
    const t = await setup(ENV, crm.routes);
    const v = await t.call("crm_buscar_tareas", { estado: "vencida" });
    expect(v.data.resultados.map((x: any) => x.titulo)).toEqual(["Llamar a Laura"]);
    expect(v.data.resultados[0].extracto).toMatch(/VENCIDA/);
    expect((await t.call("crm_buscar_tareas", { estado: "hecha" })).data.total).toBe(1);
    const s = await t.call("crm_resumen_pipeline");
    expect(s.data.oportunidades).toMatchObject({ total: 3, abiertas: 2, valor_abierto: 16500, valor_ganado: 3000 });
    expect(s.data.oportunidades.cierres_proximos_30_dias.map((d: any) => d.id)).toEqual([1]);
    expect(s.data.tareas).toMatchObject({ pendientes: 2, vencidas: 1 });
    expect(s.data.contactos.por_estado).toEqual({ lead: 1, cliente: 1, inactivo: 0 });
    await t.close();
  });

  it("clave incorrecta → error accionable", async () => {
    const crm = fakeCrm();
    const t = await setup({ ...ENV, CRM_API_KEY: "otra" }, crm.routes);
    expect((await t.call("crm_buscar_contactos", {})).text).toMatch(/auth[\s\S]*CRM_API_KEY/);
    await t.close();
  });

  it("investigar incluye el CRM cuando está configurado", async () => {
    const crm = fakeCrm();
    const t = await setup(ENV, crm.routes);
    const r = await t.call("investigar", { pregunta: "Acme", fuentes: ["crm"] });
    expect(r.data.resultados.map((x: any) => x.id)).toEqual(expect.arrayContaining(["crm:companies:1", "crm:deals:1"]));
    await t.close();
  });
});

describe("CRM: escritura", () => {
  it("sin ALLOW_WRITES las tools de escritura no existen", async () => {
    const t = await setup(ENV, fakeCrm().routes);
    const names = (await t.client.listTools()).tools.map((x) => x.name);
    expect(names).toContain("crm_buscar_contactos");
    expect(names).not.toContain("crm_crear_contacto");
    await t.close();
  });

  it("crear contacto: vista previa → token → ejecución; detecta duplicados", async () => {
    const crm = fakeCrm();
    const t = await setup({ ...ENV, ALLOW_WRITES: "true" }, crm.routes);
    const args = { nombre: "Laura", apellido: "Gómez", email: "LAURA@acme.example", empresa_id: 1 };
    const preview = await t.call("crm_crear_contacto", args);
    expect(preview.data).toMatchObject({ estado: "pendiente_confirmacion", vista_previa: { se_creara: { first_name: "Laura", status: "lead" } } });
    expect(preview.data.vista_previa.posibles_duplicados).toHaveLength(1);
    expect(crm.writes).toHaveLength(0);

    const tampered = await t.call("crm_crear_contacto", { ...args, nombre: "Otra", token_confirmacion: preview.data.token_confirmacion });
    expect(tampered.text).toMatch(/confirmation_required[\s\S]*no corresponde/);
    expect(crm.writes).toHaveLength(0);

    const done = await t.call("crm_crear_contacto", { ...args, token_confirmacion: preview.data.token_confirmacion });
    expect(done.data).toMatchObject({ estado: "ejecutado", registro: { id: "crm:contacts:3" } });
    expect(crm.writes).toHaveLength(1);

    const replay = await t.call("crm_crear_contacto", { ...args, token_confirmacion: preview.data.token_confirmacion });
    expect(replay.text).toMatch(/ya se usó/);

    // Cache was invalidated: the new contact is visible immediately.
    expect((await t.call("crm_buscar_contactos", { query: "laura" })).data.total).toBe(2);
    await t.close();
  });

  it("actualizar oportunidad muestra antes/después; completar tarea; crear tarea valida referencias", async () => {
    const crm = fakeCrm();
    const t = await setup({ ...ENV, ALLOW_WRITES: "true" }, crm.routes);
    const p = await t.call("crm_actualizar_oportunidad", { id: 1, etapa: "ganado" });
    expect(p.data.vista_previa).toEqual({ oportunidad: "Renovación anual Acme", cambios: { stage: { antes: "negociacion", despues: "ganado" } } });
    await t.call("crm_actualizar_oportunidad", { id: 1, etapa: "ganado", token_confirmacion: p.data.token_confirmacion });
    expect(crm.db.deals![0].stage).toBe("ganado");
    expect((await t.call("crm_actualizar_oportunidad", { id: 1 })).text).toMatch(/ningún cambio/);

    const c = await t.call("crm_completar_tarea", { id: 1 });
    await t.call("crm_completar_tarea", { id: 1, token_confirmacion: c.data.token_confirmacion });
    expect(crm.db.tasks![0].done).toBe(1);
    expect((await t.call("crm_completar_tarea", { id: 1 })).text).toMatch(/ya está completada/);

    expect((await t.call("crm_crear_tarea", { titulo: "x", contacto_id: 42 })).text).toMatch(/No existe contacts con id 42/);
    const nt = await t.call("crm_crear_tarea", { titulo: "Seguimiento", vence: addDays(3), oportunidad_id: 2 });
    const created = await t.call("crm_crear_tarea", { titulo: "Seguimiento", vence: addDays(3), oportunidad_id: 2, token_confirmacion: nt.data.token_confirmacion });
    expect(created.data.registro.titulo).toBe("Seguimiento");
    expect(crm.writes.at(-1)!.body).toMatchObject({ title: "Seguimiento", deal_id: 2, done: false });
    await t.close();
  });
});
