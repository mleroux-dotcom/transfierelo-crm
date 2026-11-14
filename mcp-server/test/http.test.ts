import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { startHttp } from "../src/http-transport.js";
import { silentLogger } from "../src/logger.js";
import { buildDeps } from "../src/server.js";
import { fakeFetch } from "./helpers.js";
import { publicRoutes } from "./fixtures.js";

describe("transporte HTTP streamable", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const cfg = loadConfig({ MCP_TRANSPORT: "http", MCP_HTTP_PORT: "1", MCP_AUTH_TOKEN: "secreto-de-prueba" });
    cfg.MCP_HTTP_PORT = 0 as number; // ephemeral port
    const deps = buildDeps(cfg, silentLogger, { fetch: fakeFetch(publicRoutes).fetch, sleep: async () => {} });
    server = await startHttp(cfg, deps, silentLogger);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("/healthz responde sin autenticación", async () => {
    const r = await fetch(`${base}/healthz`);
    expect(await r.json()).toMatchObject({ ok: true, name: "fuentes-mcp" });
  });

  it("rechaza peticiones sin token o con token incorrecto", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    expect((await fetch(`${base}/mcp`, { method: "POST", headers, body })).status).toBe(401);
    expect((await fetch(`${base}/mcp`, { method: "POST", headers: { ...headers, authorization: "Bearer malo" }, body })).status).toBe(401);
  });

  it("rechaza Host inesperado (DNS rebinding)", async () => {
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve) => {
      const port = (server.address() as AddressInfo).port;
      request({ host: "127.0.0.1", port, path: "/healthz", headers: { host: "evil.example" } }, (res) => resolve(res.statusCode!)).end();
    });
    expect(status).toBe(403);
  });

  it("cliente MCP oficial: initialize, tools/list y tools/call", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: "Bearer secreto-de-prueba" } } });
    const client = new Client({ name: "http-test", version: "1" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("investigar");
    const r: any = await client.callTool({ name: "buscar_wikipedia", arguments: { query: "fotosíntesis" } });
    expect(JSON.parse(r.content[0].text).resultados[0].titulo).toBe("Fotosíntesis");
    await client.close();
  });

  it("sin MCP_AUTH_TOKEN no arranca salvo opt-in explícito y en loopback", () => {
    const deps = buildDeps(loadConfig({}), silentLogger);
    expect(() => startHttp(loadConfig({ MCP_TRANSPORT: "http" }), deps, silentLogger)).toThrow(/MCP_AUTH_TOKEN/);
    expect(() => startHttp(loadConfig({ MCP_TRANSPORT: "http", MCP_ALLOW_NO_AUTH: "true", MCP_HTTP_HOST: "0.0.0.0" }), deps, silentLogger)).toThrow(/127\.0\.0\.1/);
  });
});
