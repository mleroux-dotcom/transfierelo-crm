#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, sourceStatus } from "./config.js";
import { startHttp } from "./http-transport.js";
import { createLogger } from "./logger.js";
import { buildDeps, createServer } from "./server.js";

async function main() {
  // Load .env if present (Node >= 20.12). Never overrides variables already set.
  try {
    process.loadEnvFile?.();
  } catch {}

  const cfg = loadConfig();
  const logger = createLogger(cfg.LOG_LEVEL);
  const deps = buildDeps(cfg, logger);
  const activas = Object.entries(sourceStatus(cfg))
    .filter(([, s]) => s.activa)
    .map(([k]) => k);
  logger.info("iniciando fuentes-mcp", { transporte: cfg.MCP_TRANSPORT, fuentes: activas, escritura: cfg.ALLOW_WRITES });

  // Warm the document index in the background so the first search is fast.
  deps.docs?.sync().catch((err) => logger.warn("no se pudo indexar DOCS_DIR", { error: (err as Error).message }));

  if (cfg.MCP_TRANSPORT === "http") {
    const http = await startHttp(cfg, deps, logger);
    const stop = () => {
      logger.info("apagando servidor HTTP");
      http.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } else {
    const server = createServer(deps);
    await server.connect(new StdioServerTransport());
    logger.info("servidor MCP stdio listo");
  }
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "fallo al iniciar", error: (err as Error).message }) + "\n");
  process.exit(1);
});
