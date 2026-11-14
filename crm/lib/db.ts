import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.CRM_DB_PATH || path.join(process.cwd(), "data", "crm.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  position TEXT,
  status TEXT NOT NULL DEFAULT 'lead',
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'nuevo',
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  expected_close TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function seed(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM companies").get() as { n: number };
  if (count.n > 0) return;
  db.exec(`
    INSERT INTO companies (name, industry, website, phone) VALUES
      ('Acme S.L.', 'Industria', 'https://acme.example', '+34 600 000 001'),
      ('Globex', 'Tecnología', 'https://globex.example', '+34 600 000 002');
    INSERT INTO contacts (first_name, last_name, email, phone, position, status, company_id) VALUES
      ('Laura', 'Gómez', 'laura@acme.example', '+34 611 111 111', 'Directora de compras', 'cliente', 1),
      ('Carlos', 'Ruiz', 'carlos@globex.example', '+34 622 222 222', 'CTO', 'lead', 2);
    INSERT INTO deals (title, value, stage, contact_id, company_id, expected_close) VALUES
      ('Renovación anual Acme', 12000, 'negociacion', 1, 1, date('now', '+20 days')),
      ('Piloto Globex', 4500, 'propuesta', 2, 2, date('now', '+45 days'));
    INSERT INTO tasks (title, due_date, contact_id, deal_id) VALUES
      ('Llamar a Laura para cerrar condiciones', date('now', '+2 days'), 1, 1),
      ('Enviar propuesta a Carlos', date('now', '+5 days'), 2, 2);
  `);
}

function open(): DatabaseSync {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  // Several build workers may open a brand-new file at once: wait for the lock instead of failing.
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  if (process.env.NODE_ENV !== "production") seed(db);
  return db;
}

// Reuse a single connection across hot reloads in development.
const g = globalThis as unknown as { __crmDb?: DatabaseSync };
export const db = g.__crmDb ?? (g.__crmDb = open());
