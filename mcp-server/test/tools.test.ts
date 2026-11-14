import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as F from "./fixtures.js";
import { setup, type Route } from "./helpers.js";

const PUBLIC_ONLY = { SOURCES_DISABLED: "" };
const NO_PROXY_DNS = { ALLOW_PRIVATE_URLS: "true" }; // fake fetch never touches the network; skip DNS in tests

describe("registro de tools", () => {
  it("expone solo las fuentes activas y valida entradas con Zod", async () => {
    const t = await setup(PUBLIC_ONLY, F.publicRoutes);
    const { tools } = await t.client.listTools();
    const names = tools.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["investigar", "investigar_lote", "buscar_wikipedia", "buscar_papers", "datos_banco_mundial", "leer_url", "leer_feed"]));
    expect(names).not.toContain("buscar_web"); // sin BRAVE_API_KEY/SEARXNG_URL
    expect(names).not.toContain("buscar_documentos"); // sin DOCS_DIR
    expect(names.some((n) => n.startsWith("crm_"))).toBe(false);
    for (const tool of tools) {
      expect(tool.description!.length).toBeGreaterThan(40);
      expect(tool.annotations).toBeDefined();
    }
    const bad = await t.call("buscar_wikipedia", { query: "" });
    expect(bad.isError).toBe(true);
    await t.close();
  });
});

describe("wikipedia", () => {
  it("buscar_wikipedia pagina y limpia HTML", async () => {
    const t = await setup({}, F.publicRoutes);
    const r = await t.call("buscar_wikipedia", { query: "fotosíntesis", por_pagina: 2 });
    expect(r.data.resultados[0]).toMatchObject({ titulo: "Fotosíntesis", extracto: "La fotosíntesis es un proceso", tipo: "enciclopedia", fiabilidad: "media", fecha_actualizacion: "2026-10-01T10:00:00Z" });
    expect(r.data).toMatchObject({ pagina: 1, total: 120, hay_mas: true });
    expect(r.structured).toBeDefined();
    expect(t.calls[0]!.url).toContain("es.wikipedia.org");
    await t.close();
  });

  it("obtener_articulo_wikipedia pagina por caracteres", async () => {
    const t = await setup({}, F.publicRoutes);
    const r = await t.call("obtener_articulo_wikipedia", { titulo: "Fotosíntesis", max_caracteres: 200, desde_caracter: 0, idioma: "es" });
    expect(r.data.texto.length).toBe(146);
    expect(r.data.siguiente_caracter).toBeUndefined();
    const next = await t.call("obtener_articulo_wikipedia", { titulo: "Fotosíntesis", max_caracteres: 200, desde_caracter: 100 });
    expect(next.data.texto).toBe("a luz.\n\nHistoria\nTexto adicional del artículo.");
    expect(r.data.articulo.url).toContain("wikipedia.org");
    await t.close();
  });

  it("artículo inexistente → error accionable", async () => {
    const t = await setup({}, [[/wikipedia/, { body: { query: { pages: [{ title: "X", missing: true }] } } }]]);
    const r = await t.call("obtener_articulo_wikipedia", { titulo: "X" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/not_found[\s\S]*Qué hacer: Usa buscar_wikipedia/);
    await t.close();
  });
});

describe("wikidata", () => {
  it("consultar_wikidata resuelve etiquetas y fechas de referencia", async () => {
    const t = await setup({}, F.publicRoutes);
    const r = await t.call("consultar_wikidata", { query: "Chile" });
    const e = r.data.entidades[0];
    expect(e.entidad).toMatchObject({ id: "wikidata:Q298", titulo: "Chile", tipo: "dato_estructurado" });
    expect(e.propiedades).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "P36", propiedad: "capital", valores: [{ valor: "Santiago de Chile (Q2887)", tiene_referencias: true }] }),
        expect.objectContaining({ id: "P1082", valores: [{ valor: "19960889", fecha_referencia: "2024", tiene_referencias: true }] }),
      ]),
    );
    await t.close();
  });

  it("sin query ni id → error", async () => {
    const t = await setup({}, F.publicRoutes);
    expect((await t.call("consultar_wikidata", {})).text).toMatch(/Indica query o id/);
    await t.close();
  });
});

describe("papers", () => {
  it.each([
    ["openalex", "doi:10.1000/abc.1", "alta"],
    ["crossref", "doi:10.1000/xyz.9", "alta"],
    ["pubmed", "pmid:12345", "alta"],
    ["arxiv", "arxiv:2101.00001", "media"],
  ])("buscar_papers fuente %s", async (fuente, id, fiab) => {
    const t = await setup({ CONTACT_EMAIL: "dev@example.org" }, F.publicRoutes);
    const r = await t.call("buscar_papers", { query: "photosynthesis", fuente, desde_anio: 2020 });
    expect(r.isError).toBe(false);
    expect(r.data.resultados[0]).toMatchObject({ id, fiabilidad: fiab });
    expect(r.data.resultados[0].autores.length).toBeGreaterThan(0);
    if (fuente === "openalex") {
      expect(t.calls[0]!.url).toContain("filter=from_publication_date%3A2020-01-01");
      expect(t.calls[0]!.url).toContain("mailto=dev%40example.org");
      expect(r.data.resultados[0].extracto).toBe("Photosynthesis drives growth");
    }
    await t.close();
  });

  it("obtener_paper por DOI devuelve resumen, referencias y relacionados", async () => {
    const t = await setup({}, F.publicRoutes);
    const r = await t.call("obtener_paper", { id: "https://doi.org/10.1000/abc.1" });
    expect(r.data).toMatchObject({ resumen: "Photosynthesis drives growth", referencias: ["openalex:W1"], relacionados: ["openalex:W200"] });
    await t.close();
  });

  it("obtener_paper cae a Crossref si OpenAlex no conoce el DOI", async () => {
    const t = await setup({}, [[/api\.openalex\.org/, { status: 404 }], ...F.publicRoutes]);
    const r = await t.call("obtener_paper", { id: "10.1000/xyz.9" });
    expect(r.data.paper).toMatchObject({ fuente: "crossref", titulo: "Chlorophyll review" });
    expect(r.data.resumen).toBe("Chlorophyll absorbs light.");
    await t.close();
  });

  it("obtener_paper por PMID trae el abstract estructurado", async () => {
    const t = await setup({}, F.publicRoutes);
    const r = await t.call("obtener_paper", { id: "pmid:12345" });
    expect(r.data.resumen).toBe("BACKGROUND: Vitamin D matters.\nRESULTS: Bones improved.");
    await t.close();
  });

  it("obtener_paper por arXiv e id inválido", async () => {
    const t = await setup({}, F.publicRoutes);
    expect((await t.call("obtener_paper", { id: "arxiv:2101.00001" })).data.paper.titulo).toBe("Attention for photosynthesis models");
    expect((await t.call("obtener_paper", { id: "cualquier cosa" })).text).toMatch(/invalid_input/);
    await t.close();
  });
});

describe("banco mundial", () => {
  it("datos_banco_mundial ordena la serie y cita fecha de actualización", async () => {
    const t = await setup({}, [[/api\.worldbank\.org\/v2\/country/, { body: F.wbIndicatorData }]]);
    const r = await t.call("datos_banco_mundial", { indicador: "NY.GDP.PCAP.CD", paises: ["CL"], desde_anio: 2022, hasta_anio: 2023 });
    const s = r.data.series[0];
    expect(s.valores).toEqual([{ anio: "2022", valor: 15300.1 }, { anio: "2023", valor: 17000.5 }]);
    expect(s.serie).toMatchObject({ fiabilidad: "alta", tipo: "estadistica_oficial", fecha_actualizacion: "2026-07-01" });
    expect(t.calls[0]!.url).toContain("date=2022%3A2023");
    await t.close();
  });

  it("indicador inválido → mensaje del Banco Mundial + qué hacer", async () => {
    const t = await setup({}, [[/worldbank/, { body: [{ message: [{ id: "120", key: "Invalid value", value: "The provided parameter value is not valid" }] }] }]]);
    const r = await t.call("datos_banco_mundial", { indicador: "XX", paises: ["CL"] });
    expect(r.text).toMatch(/not valid[\s\S]*buscar_indicador_banco_mundial/);
    await t.close();
  });

  it("buscar_indicador_banco_mundial", async () => {
    const t = await setup({}, [[/worldbank\.org\/v2\/indicator/, { body: F.wbIndicators }]]);
    const r = await t.call("buscar_indicador_banco_mundial", { query: "gdp per capita" });
    expect(r.data.indicadores[0].codigo).toBe("NY.GDP.PCAP.CD");
    await t.close();
  });
});

describe("github", () => {
  const routes: Route[] = [
    [/search\/repositories/, { body: { total_count: 1, items: [F.ghRepo] } }],
    [/search\/issues/, { body: { total_count: 1, items: [{ number: 7, title: "Bug", body: "falla", html_url: "https://github.com/acme/mcp-kit/issues/7", repository_url: "https://api.github.com/repos/acme/mcp-kit", state: "open", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", labels: [{ name: "bug" }], user: { login: "ana" } }] } }],
    [/search\/code/, { body: { total_count: 1, items: [{ name: "a.ts", path: "src/a.ts", html_url: "https://github.com/acme/mcp-kit/blob/main/src/a.ts", sha: "1", repository: { full_name: "acme/mcp-kit" }, text_matches: [{ fragment: "registerTool(" }] }] } }],
    [/repos\/acme\/mcp-kit\/readme/, { raw: "# MCP Kit\nInstala con npm." }],
    [/repos\/acme\/mcp-kit\/releases\/latest/, { body: { tag_name: "v1.2.0", published_at: "2026-10-01T00:00:00Z", html_url: "https://github.com/acme/mcp-kit/releases/v1.2.0" } }],
    [/repos\/acme\/mcp-kit\/contents\/src\?/, { body: [{ name: "a.ts", path: "src/a.ts", type: "file", size: 10 }] }],
    [/repos\/acme\/mcp-kit\/contents\/src\/a\.ts/, { body: { type: "file", path: "src/a.ts", sha: "abc", size: 20, html_url: "https://github.com/acme/mcp-kit/blob/main/src/a.ts", content: Buffer.from("export const a = 1;\n").toString("base64") } }],
    [/repos\/acme\/mcp-kit\/commits/, { body: [{ commit: { committer: { date: "2026-09-09T00:00:00Z" } } }] }],
    [/repos\/acme\/mcp-kit$/, { body: F.ghRepo }],
    [/repos\/acme\/privado/, { status: 404 }],
  ];

  it("buscar_github repos e issues", async () => {
    const t = await setup({}, routes);
    const repos = await t.call("buscar_github", { query: "mcp language:typescript" });
    expect(repos.data.resultados[0]).toMatchObject({ id: "github:acme/mcp-kit", fiabilidad: "media", datos: { estrellas: 1500, licencia: "MIT" } });
    const issues = await t.call("buscar_github", { query: "bug repo:acme/mcp-kit", tipo: "issues" });
    expect(issues.data.resultados[0]).toMatchObject({ id: "github:acme/mcp-kit#7", titulo: "Issue #7: Bug" });
    await t.close();
  });

  it("búsqueda de código sin token → error accionable; con token usa Bearer", async () => {
    const anon = await setup({}, routes);
    expect((await anon.call("buscar_github", { query: "registerTool", tipo: "codigo" })).text).toMatch(/GITHUB_TOKEN/);
    await anon.close();
    const auth = await setup({ GITHUB_TOKEN: "ghp_test" }, routes);
    const r = await auth.call("buscar_github", { query: "registerTool", tipo: "codigo" });
    expect(r.data.resultados[0].extracto).toBe("registerTool(");
    expect((auth.calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer ghp_test");
    await auth.close();
  });

  it("obtener_repo_github y obtener_archivo_github", async () => {
    const t = await setup({}, routes);
    const repo = await t.call("obtener_repo_github", { repo: "acme/mcp-kit" });
    expect(repo.data).toMatchObject({ readme: "# MCP Kit\nInstala con npm.", ultima_version: { tag: "v1.2.0" }, rama_principal: "main" });
    const file = await t.call("obtener_archivo_github", { repo: "acme/mcp-kit", ruta: "src/a.ts" });
    expect(file.data).toMatchObject({ tipo: "archivo", texto: "export const a = 1;\n", archivo: { fecha_actualizacion: "2026-09-09T00:00:00Z", fiabilidad: "media" } });
    const dir = await t.call("obtener_archivo_github", { repo: "acme/mcp-kit", ruta: "src" });
    expect(dir.data.entradas[0].nombre).toBe("a.ts");
    const missing = await t.call("obtener_repo_github", { repo: "acme/privado" });
    expect(missing.text).toMatch(/no existe o es privado/);
    expect((await t.call("obtener_repo_github", { repo: "no valido" })).text).toMatch(/owner\/repo/);
    await t.close();
  });

  it("403 por límite anónimo sugiere GITHUB_TOKEN", async () => {
    const t = await setup({ HTTP_RETRIES: "0" }, [[/github/, { status: 403, body: { message: "API rate limit exceeded" } }]]);
    expect((await t.call("buscar_github", { query: "x" })).text).toMatch(/Define GITHUB_TOKEN/);
    await t.close();
  });
});

describe("web", () => {
  it("leer_url HTML: texto legible, fechas y fiabilidad por dominio", async () => {
    const t = await setup(NO_PROXY_DNS, [[/ine\.gob\.cl/, { raw: F.html, headers: { "content-type": "text/html; charset=utf-8" } }]]);
    const r = await t.call("leer_url", { url: "https://www.ine.gob.cl/informe" });
    expect(r.data).toMatchObject({ formato: "html", texto: "Informe\nLa tasa fue 5,2%." });
    expect(r.data.documento).toMatchObject({ titulo: "Informe oficial", fecha_publicacion: "2025-06-01", fiabilidad: "alta" });
    await t.close();
  });

  it("leer_url PDF", async () => {
    const t = await setup(NO_PROXY_DNS, [[/doc\.pdf/, { raw: F.tinyPdf(), headers: { "content-type": "application/pdf" } }]]);
    const r = await t.call("leer_url", { url: "https://example.org/doc.pdf" });
    expect(r.isError).toBe(false);
    expect(r.data.formato).toBe("pdf");
    expect(r.data.texto).toContain("Hola PDF");
    await t.close();
  });

  it("leer_url bloquea direcciones internas", async () => {
    const t = await setup({}, []);
    const r = await t.call("leer_url", { url: "http://169.254.169.254/latest/meta-data" });
    expect(r.text).toMatch(/blocked_url[\s\S]*ALLOW_PRIVATE_URLS/);
    expect(t.calls).toHaveLength(0);
    await t.close();
  });

  it("buscar_web con Brave", async () => {
    const t = await setup({ BRAVE_API_KEY: "k" }, [[/api\.search\.brave\.com/, { body: { web: { results: [{ title: "<b>Ley</b> 21.000", url: "https://www.bcn.cl/ley", description: "Texto", page_age: "2025-01-01T00:00:00" }] }, query: { more_results_available: false } } }]]);
    const r = await t.call("buscar_web", { query: "ley 21000", recientes: "anio" });
    expect(r.data.resultados[0]).toMatchObject({ titulo: "Ley 21.000", fuente: "web (www.bcn.cl)", fecha_publicacion: "2025-01-01" });
    expect(t.calls[0]!.url).toContain("freshness=py");
    expect((t.calls[0]!.init!.headers as Record<string, string>)["x-subscription-token"]).toBe("k");
    await t.close();
  });

  it("buscar_web con SearXNG", async () => {
    const t = await setup({ SEARXNG_URL: "https://searx.example.org" }, [[/searx\.example\.org\/search/, { body: { results: [{ title: "R", url: "https://who.int/x", content: "c", engine: "ddg" }] } }]]);
    const r = await t.call("buscar_web", { query: "q" });
    expect(r.data.resultados[0]).toMatchObject({ fiabilidad: "alta", datos: { buscador: "searxng/ddg" } });
    await t.close();
  });

  it("leer_feed RSS y Atom", async () => {
    const t = await setup(NO_PROXY_DNS, [
      [/rss/, { raw: F.rss, headers: { "content-type": "application/rss+xml" } }],
      [/atom/, { raw: F.atom }],
      [/nofeed/, { raw: "<html></html>" }],
    ]);
    const rss = await t.call("leer_feed", { url: "https://www.gob.cl/rss", max_items: 1 });
    expect(rss.data.feed.titulo).toBe("Noticias Gob");
    expect(rss.data.resultados).toHaveLength(1);
    expect(rss.data.resultados[0]).toMatchObject({ titulo: "Nueva ley", extracto: "Se aprobó la ley.", fecha_publicacion: "2026-11-10", fiabilidad: "alta" });
    expect(rss.data).toMatchObject({ total: 2, hay_mas: true });
    const atom = await t.call("leer_feed", { url: "https://example.org/atom" });
    expect(atom.data.resultados[0]).toMatchObject({ url: "https://example.org/v2", autores: ["Equipo"] });
    expect((await t.call("leer_feed", { url: "https://example.org/nofeed" })).text).toMatch(/no es un feed/);
    await t.close();
  });
});

describe("documentos propios", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-"));
    await fs.mkdir(path.join(dir, "contratos"));
    await fs.writeFile(path.join(dir, "politica.md"), "# Política de devoluciones\n\nLos clientes pueden devolver productos dentro de 30 días.\n\nSe requiere boleta.");
    await fs.writeFile(path.join(dir, "contratos", "proveedor.txt"), "Contrato con el proveedor Acme. Plazo de pago: 60 días.");
    await fs.writeFile(path.join(dir, "manual.pdf"), F.tinyPdf());
    await fs.writeFile(path.join(dir, "ignorar.exe"), "binario");
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("buscar_documentos con BM25 y obtener_documento", async () => {
    const t = await setup({ DOCS_DIR: dir }, []);
    const r = await t.call("buscar_documentos", { query: "plazo devolución productos" });
    expect(r.data.resultados[0]).toMatchObject({ id: "doc:politica.md#0", titulo: "Política de devoluciones", fiabilidad: "alta" });
    const pdf = await t.call("buscar_documentos", { query: "hola pdf" });
    expect(pdf.data.resultados[0]).toMatchObject({ datos: { archivo: "manual.pdf", pagina: 1 } });
    const filtered = await t.call("buscar_documentos", { query: "plazo", archivo: "contratos/" });
    expect(filtered.data.resultados.map((x: any) => x.datos.archivo)).toEqual(["contratos/proveedor.txt"]);
    const doc = await t.call("obtener_documento", { id: "doc:contratos/proveedor.txt#0" });
    expect(doc.data.texto).toContain("60 días");
    const page = await t.call("obtener_documento", { id: "manual.pdf", pagina_pdf: 1 });
    expect(page.data).toMatchObject({ paginas_pdf: 1 });
    expect((await t.call("obtener_documento", { id: "../../etc/passwd" })).text).toMatch(/not_found/);
    await t.close();
  });

  it("iniciar_tarea indexar_documentos + consultar_tarea", async () => {
    const t = await setup({ DOCS_DIR: dir }, []);
    const start = await t.call("iniciar_tarea", { tipo: "indexar_documentos" });
    const id = start.data.tarea.id;
    await t.deps.tasks.wait(id);
    const r = await t.call("consultar_tarea", { tarea_id: id });
    expect(r.data.tarea).toMatchObject({ estado: "completada", progreso: 100, resultado: { archivos: 3 } });
    const list = await t.call("consultar_tarea", {});
    expect(list.data.tareas[0].resultado).toBeUndefined();
    await t.close();
  });
});

describe("investigar (multifuente)", () => {
  it("consulta en paralelo, deduplica, ordena y reporta fuentes fallidas", async () => {
    const routes: Route[] = [
      [/export\.arxiv\.org/, { status: 503 }],
      // Crossref returns the same DOI as OpenAlex → must be merged.
      [/api\.crossref\.org\/works\?/, { body: { message: { "total-results": 1, items: [{ ...F.crossrefItem, DOI: "10.1000/abc.1", title: ["Photosynthesis efficiency in crops"] }] } } }],
      ...F.publicRoutes,
    ];
    const t = await setup({ HTTP_RETRIES: "0" }, routes);
    const r = await t.call("investigar", { pregunta: "photosynthesis efficiency crops", fuentes: ["wikipedia", "openalex", "crossref", "arxiv", "github", "documentos"] });
    expect(r.isError).toBe(false);
    const byFuente = Object.fromEntries(r.data.fuentes.map((f: any) => [f.fuente, f.estado]));
    expect(byFuente).toEqual({ wikipedia: "ok", openalex: "ok", crossref: "ok", arxiv: "error", github: "ok", documentos: "inactiva" });
    const dois = r.data.resultados.filter((x: any) => x.id === "doi:10.1000/abc.1");
    expect(dois).toHaveLength(1);
    expect(dois[0].datos.tambien_en).toHaveLength(1);
    expect(r.data.resultados[0].id).toBe("doi:10.1000/abc.1"); // most relevant + reliable first
    expect(r.data.instrucciones).toMatch(/SOLO/);
    expect(r.data.cobertura).toMatch(/4 de 6 fuentes/);
    expect(r.structured.resultados.length).toBe(r.data.resultados.length);
    await t.close();
  });

  it("sin resultados lo declara explícitamente", async () => {
    const t = await setup({}, [[/wikipedia/, { body: { query: { pages: [] } } }]]);
    const r = await t.call("investigar", { pregunta: "zzzz", fuentes: ["wikipedia"] });
    expect(r.data.cobertura).toMatch(/NO se encontró información verificable/);
    await t.close();
  });

  it("investigar_lote ejecuta varias preguntas", async () => {
    const t = await setup({}, F.publicRoutes);
    const r = await t.call("investigar_lote", { preguntas: ["fotosíntesis", "clorofila"], fuentes: ["wikipedia"] });
    expect(r.data.investigaciones.map((x: any) => x.pregunta)).toEqual(["fotosíntesis", "clorofila"]);
    await t.close();
  });

  it("investigacion_profunda lee contenido completo y sigue relacionados", async () => {
    const t = await setup({}, F.publicRoutes);
    const start = await t.call("iniciar_tarea", { tipo: "investigacion_profunda", pregunta: "photosynthesis crops", fuentes: ["openalex", "wikipedia"], profundidad: 2 });
    const done = await t.deps.tasks.wait(start.data.tarea.id);
    expect(done.estado).toBe("completada");
    const res: any = done.resultado;
    expect(res.hallazgos).toHaveLength(2);
    expect(res.hallazgos.some((h: any) => h.contenido)).toBe(true);
    expect(res.relacionados[0]).toMatchObject({ titulo: "Related crop study", tipo: "preprint" });
    await t.close();
  });

  it("iniciar_tarea sin pregunta y cancelar_tarea inexistente", async () => {
    const t = await setup({}, F.publicRoutes);
    expect((await t.call("iniciar_tarea", { tipo: "investigacion_profunda" })).text).toMatch(/Falta 'pregunta'/);
    expect((await t.call("cancelar_tarea", { tarea_id: "00000000-0000-4000-8000-000000000000" })).text).toMatch(/not_found/);
    await t.close();
  });

  it("listar_fuentes explica por qué una fuente está inactiva", async () => {
    const t = await setup({ SOURCES_DISABLED: "arxiv" }, []);
    const r = await t.call("listar_fuentes");
    expect(r.data.fuentes.arxiv).toEqual({ activa: false, motivo: "desactivada en SOURCES_DISABLED" });
    expect(r.data.fuentes.busqueda_web.motivo).toMatch(/BRAVE_API_KEY/);
    expect(r.data.escritura_habilitada).toBe(false);
    await t.close();
  });
});

describe("prompt", () => {
  it("responder_con_fuentes", async () => {
    const t = await setup({}, []);
    const p = await t.client.getPrompt({ name: "responder_con_fuentes", arguments: { pregunta: "¿Qué es MCP?" } });
    expect((p.messages[0]!.content as any).text).toMatch(/investigar/);
    await t.close();
  });
});
