import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "../src/cache.js";
import { loadConfig, sourceStatus } from "../src/config.js";
import { canonicalJson, Confirmations } from "../src/confirm.js";
import { SourceError } from "../src/errors.js";
import { evaluarFiabilidad } from "../src/evidence.js";
import { HttpClient, redactUrl } from "../src/http.js";
import { createLogger, silentLogger } from "../src/logger.js";
import { isPrivateIp, makeUrlGuard } from "../src/sources/web.js";
import { TaskManager } from "../src/tasks.js";
import { htmlToText, normalizeDoi, normalizeUrl, tokenize } from "../src/text.js";
import { fakeFetch } from "./helpers.js";

describe("TtlCache", () => {
  it("expira por TTL y desaloja el menos usado", () => {
    let now = 0;
    const c = new TtlCache<number>(2, 100, () => now);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    now = 150;
    expect(c.get("a")).toBeUndefined();
  });
});

describe("config", () => {
  it("valores por defecto: stdio, solo lectura", () => {
    const cfg = loadConfig({});
    expect(cfg.MCP_TRANSPORT).toBe("stdio");
    expect(cfg.ALLOW_WRITES).toBe(false);
    expect(sourceStatus(cfg).crm.activa).toBe(false);
    expect(sourceStatus(cfg).documentos.motivo).toMatch(/DOCS_DIR/);
  });
  it("rechaza valores inválidos con mensaje accionable", () => {
    expect(() => loadConfig({ MCP_TRANSPORT: "ws" })).toThrow(/MCP_TRANSPORT/);
    expect(() => loadConfig({ SOURCES_DISABLED: "wikipedia,foo" })).toThrow(/foo/);
  });
  it("usa PORT de la plataforma si no hay MCP_HTTP_PORT", () => {
    expect(loadConfig({ PORT: "8080" }).MCP_HTTP_PORT).toBe(8080);
    expect(loadConfig({ PORT: "8080", MCP_HTTP_PORT: "9000" }).MCP_HTTP_PORT).toBe(9000);
  });
  it("SOURCES_DISABLED desactiva fuentes", () => {
    expect(sourceStatus(loadConfig({ SOURCES_DISABLED: "arxiv" })).arxiv.activa).toBe(false);
  });
});

describe("Confirmations", () => {
  it("token válido una sola vez y atado a los argumentos", () => {
    const c = new Confirmations();
    const { token_confirmacion } = c.issue("t", { a: 1, b: [2] });
    expect(() => c.verify("t", { a: 2, b: [2] }, token_confirmacion)).toThrow(/no corresponde/);
    expect(() => c.verify("t", { b: [2], a: 1 }, token_confirmacion)).not.toThrow();
    expect(() => c.verify("t", { a: 1, b: [2] }, token_confirmacion)).toThrow(/ya se usó/);
  });
  it("expira", () => {
    let now = 1000;
    const c = new Confirmations(undefined, 100, () => now);
    const { token_confirmacion } = c.issue("t", {});
    now = 2000;
    expect(() => c.verify("t", {}, token_confirmacion)).toThrow(/expiró/);
  });
  it("canonicalJson ordena claves", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });
});

describe("fiabilidad", () => {
  it("reglas documentadas", () => {
    expect(evaluarFiabilidad({ tipo: "paper", revisado_por_pares: true, citas: 10 }).fiabilidad).toBe("alta");
    expect(evaluarFiabilidad({ tipo: "paper", revisado_por_pares: true, retractado: true }).fiabilidad).toBe("baja");
    expect(evaluarFiabilidad({ tipo: "preprint" }).fiabilidad).toBe("media");
    expect(evaluarFiabilidad({ tipo: "web", dominio: "www.minsal.gob.cl" }).fiabilidad).toBe("alta");
    expect(evaluarFiabilidad({ tipo: "web", dominio: "blog.example.com" }).fiabilidad).toBe("baja");
    expect(evaluarFiabilidad({ tipo: "codigo", estrellas: 5000 }).fiabilidad).toBe("media");
    expect(evaluarFiabilidad({ tipo: "codigo", estrellas: 5000, archivado: true }).fiabilidad).toBe("baja");
    expect(evaluarFiabilidad({ tipo: "estadistica_oficial" }).fiabilidad).toBe("alta");
  });
});

describe("text", () => {
  it("normaliza DOI y URL", () => {
    expect(normalizeDoi("https://doi.org/10.1038/NATURE12373.")).toBe("10.1038/nature12373");
    expect(normalizeUrl("https://www.Ejemplo.com/a/?utm_source=x#frag")).toBe("ejemplo.com/a");
  });
  it("tokeniza sin acentos ni stopwords", () => {
    expect(tokenize("La Política de Devolución")).toEqual(["politica", "devolucion"]);
  });
  it("extrae texto, título y fechas de HTML", () => {
    const h = htmlToText(`<html lang="es"><head><title>T</title><meta property="article:published_time" content="2024-05-01T10:00:00Z"></head>
      <body><nav>menú</nav><article><h1>Hola</h1><p>Uno &amp; dos</p><script>x()</script></article><footer>pie</footer></body></html>`);
    expect(h.titulo).toBe("T");
    expect(h.fecha_publicacion).toBe("2024-05-01T10:00:00Z");
    expect(h.texto).toBe("Hola\nUno & dos");
    expect(h.idioma).toBe("es");
  });
});

describe("SSRF guard", () => {
  it("detecta IPs privadas", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("bloquea protocolos, hosts internos y DNS que apunta a privadas", async () => {
    const guard = makeUrlGuard(false, async (h) => (h === "evil.example" ? ["10.0.0.5"] : ["93.184.216.34"]));
    await expect(guard(new URL("file:///etc/passwd"))).rejects.toThrow(/Protocolo/);
    await expect(guard(new URL("http://localhost:8080"))).rejects.toThrow(/interno/);
    await expect(guard(new URL("http://169.254.169.254/latest"))).rejects.toThrow(/privada/);
    await expect(guard(new URL("http://evil.example/"))).rejects.toThrow(/IP privada/);
    await expect(guard(new URL("https://example.com/"))).resolves.toBeUndefined();
    await expect(makeUrlGuard(true)(new URL("http://localhost"))).resolves.toBeUndefined();
  });
});

describe("HttpClient", () => {
  const make = (routes: Parameters<typeof fakeFetch>[0], retries = 3) => {
    const ff = fakeFetch(routes);
    const sleep = vi.fn(async () => {});
    const http = new HttpClient({ fetch: ff.fetch, sleep, timeoutMs: 1000, retries, cache: new TtlCache(100, 60_000), logger: silentLogger, userAgent: "t", maxBytes: 1000 });
    return { http, ff, sleep };
  };

  it("reintenta 5xx y luego tiene éxito; cachea GET", async () => {
    let n = 0;
    const { http, ff, sleep } = make([[/x/, () => (++n < 3 ? { status: 503 } : { body: { ok: 1 } })]]);
    expect((await http.json("https://x/", { source: "s" })).body).toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledTimes(2);
    const again = await http.json("https://x/", { source: "s" });
    expect(again.fromCache).toBe(true);
    expect(ff.calls).toHaveLength(3);
  });

  it("respeta Retry-After en 429", async () => {
    let n = 0;
    const { http, sleep } = make([[/x/, () => (++n === 1 ? { status: 429, headers: { "retry-after": "2" } } : { body: {} })]]);
    await http.json("https://x/", { source: "s" });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("no reintenta 404 y da un error accionable", async () => {
    const { http, ff } = make([[/x/, { status: 404 }]]);
    const err = await http.json("https://x/", { source: "s", hints: { 404: "busca primero" } }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.code).toBe("not_found");
    expect(err.hint).toBe("busca primero");
    expect(ff.calls).toHaveLength(1);
  });

  it("se rinde tras agotar reintentos", async () => {
    const { http, ff } = make([[/x/, { status: 500 }]], 2);
    await expect(http.json("https://x/", { source: "s" })).rejects.toMatchObject({ code: "upstream_unavailable" });
    expect(ff.calls).toHaveLength(3);
  });

  it("rechaza respuestas demasiado grandes", async () => {
    const { http } = make([[/x/, { raw: "a".repeat(2000) }]]);
    await expect(http.text("https://x/", { source: "s" })).rejects.toMatchObject({ code: "too_large" });
  });

  it("revisa cada redirección con el guard", async () => {
    const { http } = make([
      [/start/, { status: 302, headers: { location: "http://127.0.0.1/admin" } }],
      [/admin/, { raw: "secreto" }],
    ]);
    await expect(http.text("https://ok.example/start", { source: "web", guardUrl: makeUrlGuard(false, async () => ["93.184.216.34"]) })).rejects.toMatchObject({ code: "blocked_url" });
  });

  it("oculta claves en URLs de logs", () => {
    expect(redactUrl("https://a/?q=1&api_key=SECRET&x=2")).toBe("https://a/?q=1&api_key=***&x=2");
  });
});

describe("logger", () => {
  it("escribe JSON y redacta secretos", () => {
    const lines: string[] = [];
    createLogger("info", (l) => lines.push(l)).info("hola", { token: "abc", n: 1 });
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "info", msg: "hola", token: "[redactado]", n: 1 });
  });
});

describe("TaskManager", () => {
  it("respeta la concurrencia, reporta progreso y permite cancelar", async () => {
    const tm = new TaskManager(1, silentLogger);
    let release!: () => void;
    const a = tm.start("x", async (progress) => {
      progress(50, "mitad");
      await new Promise<void>((r) => (release = r));
      return { listo: true };
    });
    const b = tm.start("y", async () => 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(tm.get(a.id)).toMatchObject({ estado: "ejecutando", progreso: 50 });
    expect(tm.get(b.id).estado).toBe("en_cola");
    tm.cancel(b.id);
    release();
    expect(await tm.wait(a.id)).toMatchObject({ estado: "completada", resultado: { listo: true } });
    expect(tm.get(b.id).estado).toBe("cancelada");
  });
});
