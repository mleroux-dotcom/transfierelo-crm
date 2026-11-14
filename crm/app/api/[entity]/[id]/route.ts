import { NextResponse } from "next/server";
import { get, remove, update } from "@/lib/entities";
import { handleError, notFound, parseId, readJson, resolveEntity } from "@/lib/api";

type Ctx = { params: Promise<{ entity: string; id: string }> };

async function resolve(params: Ctx["params"]) {
  const p = await params;
  return { entity: resolveEntity(p.entity), id: parseId(p.id) };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { entity, id } = await resolve(params);
  if (!entity || !id) return notFound();
  const row = get(entity, id);
  return row ? NextResponse.json({ data: row }) : notFound();
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { entity, id } = await resolve(params);
  if (!entity || !id || !get(entity, id)) return notFound();
  try {
    return NextResponse.json({ data: update(entity, id, await readJson(req)) });
  } catch (err) {
    return handleError(err);
  }
}

export const PUT = PATCH;

export async function DELETE(_req: Request, { params }: Ctx) {
  const { entity, id } = await resolve(params);
  if (!entity || !id) return notFound();
  return remove(entity, id) ? new NextResponse(null, { status: 204 }) : notFound();
}
