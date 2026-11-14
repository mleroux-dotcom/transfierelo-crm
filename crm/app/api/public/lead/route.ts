import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { create, update, type Row } from "@/lib/entities";

// Public endpoint for the website's contact forms: no API key, so it only creates leads,
// and is protected by an origin allowlist, a honeypot field and a per-IP rate limit.

const allowedOrigins = () =>
  (process.env.CRM_ALLOWED_ORIGINS || "https://transfiereloo.cl,https://www.transfiereloo.cl")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" };
}

const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

async function readBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = await req.json().catch(() => ({}));
    return Object.fromEntries(Object.entries(json ?? {}).map(([k, v]) => [k, String(v ?? "")]));
  }
  const form = await req.formData().catch(() => new FormData());
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
}

const clip = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

export async function POST(req: Request) {
  const headers = cors(req);
  const origin = req.headers.get("origin");
  const isForm = !(req.headers.get("content-type") ?? "").includes("application/json");
  const reply = (status: number, body: Record<string, unknown>, back?: string) => {
    // A plain HTML form (no JavaScript) is sent back to the page it came from.
    if (isForm && back) return NextResponse.redirect(back, 303);
    return NextResponse.json(body, { status, headers });
  };

  if (origin && !allowedOrigins().includes(origin)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "Demasiados envíos, prueba en unos minutos" }, { status: 429, headers });

  const b = await readBody(req);
  const referer = req.headers.get("referer");
  const back = (ok: boolean) => {
    const target = b._redirect || referer;
    if (!target) return undefined;
    try {
      const url = new URL(target);
      if (!allowedOrigins().includes(url.origin)) return undefined;
      url.searchParams.set("enviado", ok ? "1" : "0");
      return url.toString();
    } catch {
      return undefined;
    }
  };

  // Bots fill every field, people never see this one.
  if (b.sitio_web) return reply(200, { ok: true }, back(true));

  const nombre = clip(b.nombre, 120);
  const email = clip(b.email, 200).toLowerCase();
  const telefono = clip(b.telefono, 40);
  if (!nombre || (!email && !telefono)) {
    return reply(400, { error: "Indica tu nombre y un email o teléfono" }, back(false));
  }
  const mensaje = clip(b.mensaje, 4000);
  const origen = clip(b.origen, 120) || referer || "web";
  const nota = `[${new Date().toISOString().slice(0, 16).replace("T", " ")}] Formulario web (${origen})${mensaje ? `:\n${mensaje}` : ""}`;

  const existing = email ? (db.prepare("SELECT * FROM contacts WHERE lower(email) = ? LIMIT 1").get(email) as Row | undefined) : undefined;
  const contact = existing
    ? update("contacts", Number(existing.id), { notes: [existing.notes, nota].filter(Boolean).join("\n\n"), ...(telefono && !existing.phone && { phone: telefono }) })!
    : create("contacts", {
        first_name: nombre.split(" ")[0],
        last_name: nombre.split(" ").slice(1).join(" "),
        email,
        phone: telefono,
        status: "lead",
        notes: [clip(b.empresa, 120) && `Empresa: ${clip(b.empresa, 120)}`, nota].filter(Boolean).join("\n"),
      });

  const due = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  create("tasks", { title: `Contactar a ${nombre} (formulario web)`, due_date: due, contact_id: contact.id });

  return reply(201, { ok: true }, back(true));
}
