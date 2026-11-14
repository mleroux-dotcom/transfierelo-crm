import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import type { AppDeps } from "./tools/helpers.js";

const MAX_BODY = 1_000_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) {
  json(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null }, headers);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 });
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    throw Object.assign(new Error("JSON inválido"), { status: 400 });
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Streamable HTTP transport in stateless mode: every POST /mcp gets a fresh McpServer + transport,
 * sharing the same dependencies (cache, task queue, document index). Scales horizontally and
 * survives restarts without session bookkeeping. Background tasks live in this process.
 */
export function startHttp(cfg: Config, deps: AppDeps, logger: Logger): Promise<Server> {
  if (!cfg.MCP_AUTH_TOKEN && !cfg.MCP_ALLOW_NO_AUTH) {
    throw new Error("MCP_TRANSPORT=http requiere MCP_AUTH_TOKEN (o MCP_ALLOW_NO_AUTH=true solo para pruebas locales).");
  }
  if (!cfg.MCP_AUTH_TOKEN && !LOOPBACK.has(cfg.MCP_HTTP_HOST)) {
    throw new Error("Sin MCP_AUTH_TOKEN solo se permite escuchar en 127.0.0.1/localhost.");
  }
  const allowedHosts = cfg.MCP_ALLOWED_HOSTS.length
    ? cfg.MCP_ALLOWED_HOSTS.map((h) => h.toLowerCase())
    : LOOPBACK.has(cfg.MCP_HTTP_HOST)
      ? ["127.0.0.1", "localhost", "[::1]"]
      : [];

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const t0 = Date.now();
    res.on("finish", () => logger.debug("http request", { method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - t0 }));

    // DNS-rebinding protection: only accept expected Host headers.
    const host = (req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
    if (allowedHosts.length && !allowedHosts.includes(host)) return rpcError(res, 403, `Host no permitido: ${host}. Agrégalo a MCP_ALLOWED_HOSTS.`);

    if (url.pathname === "/healthz") return json(res, 200, { ok: true, name: SERVER_NAME, version: SERVER_VERSION });
    if (url.pathname !== "/mcp") return json(res, 404, { error: "No encontrado. El endpoint MCP es /mcp" });

    if (cfg.MCP_AUTH_TOKEN) {
      const auth = req.headers.authorization ?? "";
      const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!given || !safeEqual(given, cfg.MCP_AUTH_TOKEN)) {
        return rpcError(res, 401, "No autorizado: envía 'Authorization: Bearer <MCP_AUTH_TOKEN>'.", { "www-authenticate": 'Bearer realm="fuentes-mcp"' });
      }
    }

    if (req.method !== "POST") {
      // Stateless mode: no standalone SSE stream (GET) and no sessions to delete (DELETE).
      return rpcError(res, 405, "Método no permitido; usa POST.", { allow: "POST" });
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      return rpcError(res, (err as { status?: number }).status ?? 400, (err as Error).message);
    }

    const mcp = createServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      logger.error("error atendiendo petición MCP", { error: (err as Error).message });
      if (!res.headersSent) rpcError(res, 500, "Error interno del servidor");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.MCP_HTTP_PORT, cfg.MCP_HTTP_HOST, () => {
      logger.info("servidor MCP HTTP escuchando", { url: `http://${cfg.MCP_HTTP_HOST}:${cfg.MCP_HTTP_PORT}/mcp`, auth: !!cfg.MCP_AUTH_TOKEN });
      resolve(server);
    });
  });
}
