import { NextResponse } from "next/server";
import { create, list } from "@/lib/entities";
import { handleError, notFound, readJson, resolveEntity } from "@/lib/api";

type Ctx = { params: Promise<{ entity: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const entity = resolveEntity((await params).entity);
  if (!entity) return notFound("Recurso desconocido");
  const search = new URL(req.url).searchParams;
  const q = search.get("q") ?? undefined;
  search.delete("q");
  return NextResponse.json({ data: list(entity, { q, filters: Object.fromEntries(search) }) });
}

export async function POST(req: Request, { params }: Ctx) {
  const entity = resolveEntity((await params).entity);
  if (!entity) return notFound("Recurso desconocido");
  try {
    return NextResponse.json({ data: create(entity, await readJson(req)) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
