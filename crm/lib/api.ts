import "server-only";
import { NextResponse } from "next/server";
import { ValidationError, isEntity, type EntityName } from "./entities";

export function notFound(message = "No encontrado") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function resolveEntity(name: string): EntityName | null {
  return isEntity(name) ? name : null;
}

export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new ValidationError("El cuerpo debe ser un objeto JSON");
}

export function handleError(err: unknown) {
  if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
  console.error(err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}
