import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import type { FetchLike } from "../src/http.js";
import { silentLogger } from "../src/logger.js";
import { buildDeps, createServer } from "../src/server.js";
import type { AppDeps } from "../src/tools/helpers.js";

export type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; raw?: string | Buffer };
export type Route = [RegExp, Reply | ((url: string, init?: RequestInit) => Reply)];

/** Fake fetch: first matching route wins; unmatched URLs fail loudly so tests never hit the network. */
export function fakeFetch(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const route = routes.find(([re]) => re.test(url));
    if (!route) throw new Error(`fetch no simulado: ${url}`);
    const r = typeof route[1] === "function" ? route[1](url, init) : route[1];
    const isJson = r.raw === undefined;
    const payload = isJson ? JSON.stringify(r.body ?? {}) : r.raw!;
    return new Response(payload as BodyInit, {
      status: r.status ?? 200,
      headers: { "content-type": isJson ? "application/json" : "text/plain", ...r.headers },
    });
  };
  return { fetch: fn, calls };
}

export async function setup(env: Record<string, string> = {}, routes: Route[] = []) {
  const cfg = loadConfig({ HTTP_RETRIES: "2", ...env } as NodeJS.ProcessEnv);
  const ff = fakeFetch(routes);
  const deps: AppDeps = buildDeps(cfg, silentLogger, { fetch: ff.fetch, sleep: async () => {} });
  const server = createServer(deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    const text: string = r.content?.[0]?.text ?? "";
    return { isError: !!r.isError, text, data: r.isError ? undefined : JSON.parse(text), structured: r.structuredContent };
  };
  return { client, call, calls: ff.calls, deps, close: () => client.close() };
}
