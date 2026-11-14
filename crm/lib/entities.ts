import "server-only";
import type { SQLInputValue } from "node:sqlite";
import { db } from "./db";

export const CONTACT_STATUSES = ["lead", "cliente", "inactivo"] as const;
export const DEAL_STAGES = ["nuevo", "contactado", "propuesta", "negociacion", "ganado", "perdido"] as const;

export const STAGE_LABELS: Record<string, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  propuesta: "Propuesta",
  negociacion: "Negociación",
  ganado: "Ganado",
  perdido: "Perdido",
};

type FieldType = "text" | "number" | "int" | "bool" | "date";
type Field = { type: FieldType; required?: boolean; options?: readonly string[]; default?: SQLInputValue };

type EntityDef = {
  table: string;
  fields: Record<string, Field>;
  searchable: string[];
  orderBy: string;
};

export const ENTITIES = {
  companies: {
    table: "companies",
    fields: {
      name: { type: "text", required: true },
      industry: { type: "text" },
      website: { type: "text" },
      phone: { type: "text" },
      notes: { type: "text" },
    },
    searchable: ["name", "industry"],
    orderBy: "name COLLATE NOCASE",
  },
  contacts: {
    table: "contacts",
    fields: {
      first_name: { type: "text", required: true },
      last_name: { type: "text" },
      email: { type: "text" },
      phone: { type: "text" },
      position: { type: "text" },
      status: { type: "text", options: CONTACT_STATUSES, default: "lead" },
      company_id: { type: "int" },
      notes: { type: "text" },
    },
    searchable: ["first_name", "last_name", "email", "phone"],
    orderBy: "first_name COLLATE NOCASE, last_name COLLATE NOCASE",
  },
  deals: {
    table: "deals",
    fields: {
      title: { type: "text", required: true },
      value: { type: "number", default: 0 },
      stage: { type: "text", options: DEAL_STAGES, default: "nuevo" },
      contact_id: { type: "int" },
      company_id: { type: "int" },
      expected_close: { type: "date" },
      notes: { type: "text" },
    },
    searchable: ["title"],
    orderBy: "created_at DESC",
  },
  tasks: {
    table: "tasks",
    fields: {
      title: { type: "text", required: true },
      due_date: { type: "date" },
      done: { type: "bool" },
      contact_id: { type: "int" },
      deal_id: { type: "int" },
    },
    searchable: ["title"],
    orderBy: "done ASC, due_date IS NULL, due_date ASC",
  },
} satisfies Record<string, EntityDef>;

export type EntityName = keyof typeof ENTITIES;
export type Row = Record<string, SQLInputValue>;

export class ValidationError extends Error {}

export function isEntity(name: string): name is EntityName {
  return Object.hasOwn(ENTITIES, name);
}

function coerce(name: string, field: Field, raw: unknown): SQLInputValue {
  if (raw === undefined || raw === null || raw === "") {
    if (field.required) throw new ValidationError(`El campo "${name}" es obligatorio`);
    if (field.type === "bool") return 0;
    return field.default ?? null;
  }
  switch (field.type) {
    case "number":
    case "int": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new ValidationError(`El campo "${name}" debe ser numérico`);
      return field.type === "int" ? Math.trunc(n) : n;
    }
    case "bool":
      return raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "on" ? 1 : 0;
    case "date": {
      const s = String(raw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`El campo "${name}" debe tener formato AAAA-MM-DD`);
      return s;
    }
    default: {
      const s = String(raw).trim();
      if (field.options && !field.options.includes(s)) {
        throw new ValidationError(`"${name}" debe ser uno de: ${field.options.join(", ")}`);
      }
      return s;
    }
  }
}

/** Picks and validates known fields. With `partial`, missing fields are left untouched. */
function clean(entity: EntityName, input: Record<string, unknown>, partial: boolean): Row {
  const out: Row = {};
  for (const [name, field] of Object.entries(ENTITIES[entity].fields) as [string, Field][]) {
    if (partial && !(name in input)) continue;
    out[name] = coerce(name, field, input[name]);
  }
  return out;
}

export function list(entity: EntityName, opts: { q?: string; filters?: Record<string, string> } = {}): Row[] {
  const def: EntityDef = ENTITIES[entity];
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (opts.q) {
    where.push("(" + def.searchable.map((c) => `${c} LIKE ?`).join(" OR ") + ")");
    def.searchable.forEach(() => params.push(`%${opts.q}%`));
  }
  for (const [key, value] of Object.entries(opts.filters ?? {})) {
    if (!(key in def.fields) || value === "") continue;
    where.push(`${key} = ?`);
    params.push(value);
  }
  const sql =
    `SELECT * FROM ${def.table}` + (where.length ? ` WHERE ${where.join(" AND ")}` : "") + ` ORDER BY ${def.orderBy}`;
  return db.prepare(sql).all(...params) as Row[];
}

export function get(entity: EntityName, id: number): Row | undefined {
  return db.prepare(`SELECT * FROM ${ENTITIES[entity].table} WHERE id = ?`).get(id) as Row | undefined;
}

export function create(entity: EntityName, input: Record<string, unknown>): Row {
  const data = clean(entity, input, false);
  const cols = Object.keys(data);
  const result = db
    .prepare(`INSERT INTO ${ENTITIES[entity].table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .run(...Object.values(data));
  return get(entity, Number(result.lastInsertRowid))!;
}

export function update(entity: EntityName, id: number, input: Record<string, unknown>): Row | undefined {
  const data = clean(entity, input, true);
  const cols = Object.keys(data);
  if (cols.length) {
    db.prepare(`UPDATE ${ENTITIES[entity].table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
      ...Object.values(data),
      id,
    );
  }
  return get(entity, id);
}

export function remove(entity: EntityName, id: number): boolean {
  return db.prepare(`DELETE FROM ${ENTITIES[entity].table} WHERE id = ?`).run(id).changes > 0;
}

/** Converts a submitted form into a plain object (unchecked checkboxes become false). */
export function formToObject(entity: EntityName, form: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(ENTITIES[entity].fields) as [string, Field][]) {
    if (field.type === "bool") obj[name] = form.get(name) === "on";
    else if (form.has(name)) obj[name] = form.get(name);
  }
  return obj;
}

export function dashboardStats() {
  const one = (sql: string) => (db.prepare(sql).get() as { n: number | null }).n ?? 0;
  return {
    contacts: one("SELECT COUNT(*) AS n FROM contacts"),
    companies: one("SELECT COUNT(*) AS n FROM companies"),
    openDeals: one("SELECT COUNT(*) AS n FROM deals WHERE stage NOT IN ('ganado','perdido')"),
    pipelineValue: one("SELECT SUM(value) AS n FROM deals WHERE stage NOT IN ('ganado','perdido')"),
    wonValue: one("SELECT SUM(value) AS n FROM deals WHERE stage = 'ganado'"),
    pendingTasks: one("SELECT COUNT(*) AS n FROM tasks WHERE done = 0"),
  };
}

/** id → display name lookups, used to render relations in lists and selects. */
export function lookups() {
  const companies = db.prepare("SELECT id, name FROM companies ORDER BY name COLLATE NOCASE").all() as {
    id: number;
    name: string;
  }[];
  const contacts = db
    .prepare(
      "SELECT id, trim(first_name || ' ' || coalesce(last_name, '')) AS name FROM contacts ORDER BY first_name COLLATE NOCASE",
    )
    .all() as { id: number; name: string }[];
  const deals = db.prepare("SELECT id, title AS name FROM deals ORDER BY created_at DESC").all() as {
    id: number;
    name: string;
  }[];
  const toMap = (rows: { id: number; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
  return {
    companies,
    contacts,
    deals,
    companyName: toMap(companies),
    contactName: toMap(contacts),
    dealName: toMap(deals),
  };
}
