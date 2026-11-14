import { NextResponse } from "next/server";
import { ENTITIES } from "@/lib/entities";

// Machine-readable description of the API, handy for wiring the CRM into Emergent or other tools.
export function GET(req: Request) {
  const jsonType = { number: "number", int: "integer", bool: "boolean", date: "string", text: "string" } as const;
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(ENTITIES)) {
    const properties: Record<string, unknown> = { id: { type: "integer", readOnly: true } };
    const required: string[] = [];
    for (const [field, spec] of Object.entries(def.fields) as [string, { type: keyof typeof jsonType; required?: boolean; options?: readonly string[] }][]) {
      properties[field] = {
        type: jsonType[spec.type],
        ...(spec.type === "date" && { format: "date" }),
        ...(spec.options && { enum: spec.options }),
      };
      if (spec.required) required.push(field);
    }
    schemas[name] = { type: "object", properties, required };
    const ref = { $ref: `#/components/schemas/${name}` };
    const body = { required: true, content: { "application/json": { schema: ref } } };
    const one = { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: ref } } } } };
    paths[`/api/${name}`] = {
      get: {
        summary: `Listar ${name}`,
        parameters: [{ name: "q", in: "query", schema: { type: "string" }, description: "Búsqueda de texto" }],
        responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: ref } } } } } } },
      },
      post: { summary: `Crear ${name}`, requestBody: body, responses: { 201: one } },
    };
    const idParam = [{ name: "id", in: "path", required: true, schema: { type: "integer" } }];
    paths[`/api/${name}/{id}`] = {
      get: { summary: `Obtener ${name}`, parameters: idParam, responses: { 200: one } },
      patch: { summary: `Actualizar ${name}`, parameters: idParam, requestBody: body, responses: { 200: one } },
      delete: { summary: `Borrar ${name}`, parameters: idParam, responses: { 204: { description: "Borrado" } } },
    };
  }

  return NextResponse.json({
    openapi: "3.0.3",
    info: { title: "Mi CRM API", version: "1.0.0" },
    servers: [{ url: new URL(req.url).origin }],
    security: [{ apiKey: [] }],
    components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } }, schemas },
    paths,
  });
}
