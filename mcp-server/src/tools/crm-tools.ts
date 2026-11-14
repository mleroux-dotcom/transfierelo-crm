import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SourceError } from "../errors.js";
import { PaginaSchema } from "../evidence.js";
import { CONTACT_STATUSES, DEAL_STAGES, paginar, resumenPipeline, today, type CrmClient } from "../sources/crm.js";
import { handler, paginacion, type AppDeps } from "./helpers.js";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa formato AAAA-MM-DD");
const id = z.number().int().positive();
const CRM_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const contains = (v: unknown, q?: string) => !q || String(v ?? "").toLowerCase().includes(q.toLowerCase());

export function registerCrmTools(server: McpServer, d: AppDeps) {
  const crm = d.crm!;
  const log = d.logger;
  const out = PaginaSchema.shape;

  server.registerTool(
    "crm_buscar_contactos",
    {
      title: "CRM: buscar contactos",
      description: "Busca personas en el CRM Transfiereloo por nombre, email o teléfono, con filtro por estado (lead/cliente/inactivo) y empresa. Fuente de verdad para datos de clientes.",
      inputSchema: { query: z.string().max(200).optional(), estado: z.enum(CONTACT_STATUSES).optional(), empresa_id: id.optional(), ...paginacion },
      outputSchema: out,
      annotations: CRM_READ,
    },
    handler(log, "crm_buscar_contactos", async (a) => paginar(crm, "contacts", await crm.list("contacts", { q: a.query, status: a.estado, company_id: a.empresa_id }), a)),
  );

  server.registerTool(
    "crm_obtener_contacto",
    {
      title: "CRM: ficha de contacto",
      description: "Ficha completa de un contacto: datos, su empresa, sus oportunidades y sus tareas.",
      inputSchema: { id },
      annotations: CRM_READ,
    },
    handler(log, "crm_obtener_contacto", async (a) => {
      const c = await crm.get("contacts", a.id);
      const [empresa, deals, tasks] = await Promise.all([crm.getOptional("companies", c.company_id), crm.list("deals", { contact_id: a.id }), crm.list("tasks", { contact_id: a.id })]);
      return {
        contacto: crm.evidencia("contacts", c),
        empresa: empresa ? crm.evidencia("companies", empresa) : null,
        oportunidades: deals.map((r) => crm.evidencia("deals", r)),
        tareas: tasks.map((r) => crm.evidencia("tasks", r)),
      };
    }),
  );

  server.registerTool(
    "crm_buscar_empresas",
    {
      title: "CRM: buscar empresas",
      description: "Busca empresas del CRM por nombre o industria.",
      inputSchema: { query: z.string().max(200).optional(), industria: z.string().max(100).optional(), ...paginacion },
      outputSchema: out,
      annotations: CRM_READ,
    },
    handler(log, "crm_buscar_empresas", async (a) => {
      const rows = (await crm.list("companies", { q: a.query })).filter((r) => contains(r.industry, a.industria));
      return paginar(crm, "companies", rows, a);
    }),
  );

  server.registerTool(
    "crm_obtener_empresa",
    {
      title: "CRM: ficha de empresa",
      description: "Detalle de una empresa con sus contactos y oportunidades.",
      inputSchema: { id },
      annotations: CRM_READ,
    },
    handler(log, "crm_obtener_empresa", async (a) => {
      const e = await crm.get("companies", a.id);
      const [contacts, deals] = await Promise.all([crm.list("contacts", { company_id: a.id }), crm.list("deals", { company_id: a.id })]);
      return { empresa: crm.evidencia("companies", e), contactos: contacts.map((r) => crm.evidencia("contacts", r)), oportunidades: deals.map((r) => crm.evidencia("deals", r)) };
    }),
  );

  server.registerTool(
    "crm_buscar_oportunidades",
    {
      title: "CRM: buscar oportunidades",
      description: "Consulta el pipeline de ventas: filtra por etapa, contacto, empresa, rango de fecha de cierre y valor mínimo.",
      inputSchema: {
        query: z.string().max(200).optional(),
        etapa: z.enum(DEAL_STAGES).optional(),
        contacto_id: id.optional(),
        empresa_id: id.optional(),
        cierre_desde: fecha.optional(),
        cierre_hasta: fecha.optional(),
        valor_min: z.number().min(0).optional(),
        ...paginacion,
      },
      outputSchema: out,
      annotations: CRM_READ,
    },
    handler(log, "crm_buscar_oportunidades", async (a) => {
      const rows = (await crm.list("deals", { q: a.query, stage: a.etapa, contact_id: a.contacto_id, company_id: a.empresa_id })).filter(
        (r) =>
          (!a.cierre_desde || (r.expected_close && r.expected_close >= a.cierre_desde)) &&
          (!a.cierre_hasta || (r.expected_close && r.expected_close <= a.cierre_hasta)) &&
          (a.valor_min === undefined || Number(r.value) >= a.valor_min),
      );
      return paginar(crm, "deals", rows, a);
    }),
  );

  server.registerTool(
    "crm_obtener_oportunidad",
    {
      title: "CRM: detalle de oportunidad",
      description: "Detalle de una oportunidad con su contacto, empresa y tareas.",
      inputSchema: { id },
      annotations: CRM_READ,
    },
    handler(log, "crm_obtener_oportunidad", async (a) => {
      const deal = await crm.get("deals", a.id);
      const [c, e, tasks] = await Promise.all([crm.getOptional("contacts", deal.contact_id), crm.getOptional("companies", deal.company_id), crm.list("tasks", { deal_id: a.id })]);
      return { oportunidad: crm.evidencia("deals", deal), contacto: c ? crm.evidencia("contacts", c) : null, empresa: e ? crm.evidencia("companies", e) : null, tareas: tasks.map((r) => crm.evidencia("tasks", r)) };
    }),
  );

  server.registerTool(
    "crm_buscar_tareas",
    {
      title: "CRM: buscar tareas",
      description: "Lista tareas del CRM: pendientes, hechas o vencidas (pendientes con fecha anterior a hoy), por rango de vencimiento, contacto u oportunidad.",
      inputSchema: {
        query: z.string().max(200).optional(),
        estado: z.enum(["pendiente", "hecha", "vencida"]).optional(),
        vence_desde: fecha.optional(),
        vence_hasta: fecha.optional(),
        contacto_id: id.optional(),
        oportunidad_id: id.optional(),
        ...paginacion,
      },
      outputSchema: out,
      annotations: CRM_READ,
    },
    handler(log, "crm_buscar_tareas", async (a) => {
      const hoy = today();
      const rows = (await crm.list("tasks", { q: a.query, contact_id: a.contacto_id, deal_id: a.oportunidad_id })).filter((r) => {
        if (a.estado === "pendiente" && r.done) return false;
        if (a.estado === "hecha" && !r.done) return false;
        if (a.estado === "vencida" && (r.done || !r.due_date || r.due_date >= hoy)) return false;
        if (a.vence_desde && (!r.due_date || r.due_date < a.vence_desde)) return false;
        if (a.vence_hasta && (!r.due_date || r.due_date > a.vence_hasta)) return false;
        return true;
      });
      return paginar(crm, "tasks", rows, a);
    }),
  );

  server.registerTool(
    "crm_resumen_pipeline",
    {
      title: "CRM: resumen del pipeline",
      description: "Totales calculados del CRM: contactos por estado, oportunidades y valor por etapa, valor abierto y ganado, cierres próximos (30 días), tareas pendientes y vencidas. Usa estas cifras en vez de sumar a mano.",
      inputSchema: {},
      annotations: CRM_READ,
    },
    handler(log, "crm_resumen_pipeline", () => resumenPipeline(crm)),
  );

  if (d.cfg.ALLOW_WRITES) registerCrmWriteTools(server, d, crm);
}

// ---------- writes: two-step confirmation ----------

const token = z.string().max(200).optional().describe("Déjalo vacío la primera vez. Solo tras la aprobación explícita del usuario, repite la llamada con los MISMOS argumentos y el token recibido.");
const WRITE = { readOnlyHint: false, openWorldHint: false } as const;
const CONFIRM_TEXT = "NO se ha guardado nada. Muestra esta vista previa al usuario y pide su aprobación explícita. Si aprueba, llama de nuevo a esta tool con los mismos argumentos y token_confirmacion.";

function confirmable<A extends { token_confirmacion?: string }>(
  d: AppDeps,
  tool: string,
  preview: (args: Omit<A, "token_confirmacion">) => Promise<object>,
  execute: (args: Omit<A, "token_confirmacion">) => Promise<object>,
) {
  return handler(d.logger, tool, async (a: A) => {
    const { token_confirmacion, ...args } = a;
    if (!token_confirmacion) {
      return { estado: "pendiente_confirmacion", accion: tool, vista_previa: await preview(args), ...d.confirmations.issue(tool, args), instrucciones: CONFIRM_TEXT };
    }
    d.confirmations.verify(tool, args, token_confirmacion);
    const result = await execute(args);
    d.logger.info("escritura en CRM ejecutada", { tool });
    return { estado: "ejecutado", accion: tool, ...result };
  });
}

async function assertExists(crm: CrmClient, entity: "contacts" | "companies" | "deals", rid?: number) {
  if (rid && !(await crm.getOptional(entity, rid))) {
    throw new SourceError("not_found", `No existe ${entity} con id ${rid}.`, "Búscalo primero con la tool crm_buscar_* correspondiente.", false, "crm");
  }
}

function registerCrmWriteTools(server: McpServer, d: AppDeps, crm: CrmClient) {
  const contactoInput = {
    nombre: z.string().min(1).max(100),
    apellido: z.string().max(100).optional(),
    email: z.string().email().optional(),
    telefono: z.string().max(40).optional(),
    cargo: z.string().max(100).optional(),
    estado: z.enum(CONTACT_STATUSES).default("lead"),
    empresa_id: id.optional(),
    notas: z.string().max(5000).optional(),
    token_confirmacion: token,
  };
  type ContactoArgs = { nombre: string; apellido?: string; email?: string; telefono?: string; cargo?: string; estado: string; empresa_id?: number; notas?: string };
  const toContact = (a: ContactoArgs) => ({ first_name: a.nombre, last_name: a.apellido, email: a.email, phone: a.telefono, position: a.cargo, status: a.estado, company_id: a.empresa_id, notes: a.notas });

  server.registerTool(
    "crm_crear_contacto",
    {
      title: "CRM: crear contacto (requiere confirmación)",
      description: "Crea un contacto. Paso 1 (sin token): devuelve vista previa, posibles duplicados por email y token. Paso 2 (con token, tras aprobación del usuario): lo crea.",
      inputSchema: contactoInput,
      annotations: { ...WRITE, destructiveHint: false, idempotentHint: false },
    },
    confirmable<ContactoArgs & { token_confirmacion?: string }>(
      d,
      "crm_crear_contacto",
      async (a) => {
        await assertExists(crm, "companies", a.empresa_id);
        const duplicados = a.email ? (await crm.list("contacts", { q: a.email })).filter((c) => String(c.email ?? "").toLowerCase() === a.email!.toLowerCase()) : [];
        return { se_creara: toContact(a), posibles_duplicados: duplicados.map((r) => crm.evidencia("contacts", r)) };
      },
      async (a) => ({ registro: crm.evidencia("contacts", await crm.create("contacts", toContact(a))) }),
    ),
  );

  type TareaArgs = { titulo: string; vence?: string; contacto_id?: number; oportunidad_id?: number };
  server.registerTool(
    "crm_crear_tarea",
    {
      title: "CRM: crear tarea (requiere confirmación)",
      description: "Crea una tarea de seguimiento, opcionalmente asociada a un contacto u oportunidad. Requiere confirmación en dos pasos.",
      inputSchema: { titulo: z.string().min(1).max(200), vence: fecha.optional(), contacto_id: id.optional(), oportunidad_id: id.optional(), token_confirmacion: token },
      annotations: { ...WRITE, destructiveHint: false, idempotentHint: false },
    },
    confirmable<TareaArgs & { token_confirmacion?: string }>(
      d,
      "crm_crear_tarea",
      async (a) => {
        await Promise.all([assertExists(crm, "contacts", a.contacto_id), assertExists(crm, "deals", a.oportunidad_id)]);
        return { se_creara: { title: a.titulo, due_date: a.vence, contact_id: a.contacto_id, deal_id: a.oportunidad_id } };
      },
      async (a) => ({ registro: crm.evidencia("tasks", await crm.create("tasks", { title: a.titulo, due_date: a.vence, contact_id: a.contacto_id, deal_id: a.oportunidad_id, done: false })) }),
    ),
  );

  type OpArgs = { id: number; etapa?: string; valor?: number; cierre_esperado?: string; notas?: string };
  const opPatch = (a: OpArgs) => Object.fromEntries(Object.entries({ stage: a.etapa, value: a.valor, expected_close: a.cierre_esperado, notes: a.notas }).filter(([, v]) => v !== undefined));
  server.registerTool(
    "crm_actualizar_oportunidad",
    {
      title: "CRM: actualizar oportunidad (requiere confirmación)",
      description: "Cambia etapa, valor, fecha de cierre esperada o notas de una oportunidad. Paso 1 muestra el antes/después; paso 2 (con token) aplica el cambio.",
      inputSchema: { id, etapa: z.enum(DEAL_STAGES).optional(), valor: z.number().min(0).optional(), cierre_esperado: fecha.optional(), notas: z.string().max(5000).optional(), token_confirmacion: token },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    confirmable<OpArgs & { token_confirmacion?: string }>(
      d,
      "crm_actualizar_oportunidad",
      async (a) => {
        const patch = opPatch(a);
        if (!Object.keys(patch).length) throw new SourceError("invalid_input", "No indicaste ningún cambio.", "Pasa al menos uno de: etapa, valor, cierre_esperado, notas.");
        const actual = await crm.get("deals", a.id);
        return { oportunidad: actual.title, cambios: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { antes: actual[k] ?? null, despues: v }])) };
      },
      async (a) => ({ registro: crm.evidencia("deals", await crm.update("deals", a.id, opPatch(a))) }),
    ),
  );

  server.registerTool(
    "crm_completar_tarea",
    {
      title: "CRM: marcar tarea como hecha (requiere confirmación)",
      description: "Marca una tarea como completada. Requiere confirmación en dos pasos.",
      inputSchema: { id, token_confirmacion: token },
      annotations: { ...WRITE, destructiveHint: false, idempotentHint: true },
    },
    confirmable<{ id: number; token_confirmacion?: string }>(
      d,
      "crm_completar_tarea",
      async (a) => {
        const t = await crm.get("tasks", a.id);
        if (t.done) throw new SourceError("invalid_input", "La tarea ya está completada.", "No hace falta ninguna acción.");
        return { tarea: crm.evidencia("tasks", t), cambio: { done: { antes: false, despues: true } } };
      },
      async (a) => ({ registro: crm.evidencia("tasks", await crm.update("tasks", a.id, { done: true })) }),
    ),
  );
}
