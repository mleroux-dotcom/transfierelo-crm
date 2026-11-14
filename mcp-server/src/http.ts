import { TtlCache } from "./cache.js";
import { SourceError } from "./errors.js";
import type { Logger } from "./logger.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ResponseType = "json" | "text" | "bytes";

export interface HttpResult<T = unknown> {
  status: number;
  url: string;
  contentType: string;
  headers: Record<string, string>;
  body: T;
  fromCache: boolean;
}

export interface RequestOptions {
  source: string;
  method?: "GET" | "POST" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  responseType?: ResponseType;
  /** Override the default TTL; 0 disables caching for this call. Only GET is cached. */
  cacheTtlMs?: number;
  /** Extra text mixed into the cache key (e.g. which credential was used). */
  cacheScope?: string;
  /** Called for every URL hop (initial + redirects). Throw to block. Enables manual redirect handling. */
  guardUrl?: (url: URL) => Promise<void>;
  maxBytes?: number;
  /** Custom hint builder for HTTP errors of this source. */
  hints?: Partial<Record<number, string>>;
}

export interface HttpClientOptions {
  fetch?: FetchLike;
  timeoutMs: number;
  retries: number;
  cache: TtlCache<HttpResult>;
  logger: Logger;
  userAgent: string;
  maxBytes: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpClientOptions) {
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get cache(): TtlCache<HttpResult> {
    return this.opts.cache;
  }

  async json<T = any>(url: string, o: RequestOptions): Promise<HttpResult<T>> {
    return this.request<T>(url, { ...o, responseType: "json" });
  }

  async text(url: string, o: RequestOptions): Promise<HttpResult<string>> {
    return this.request<string>(url, { ...o, responseType: "text" });
  }

  async request<T = unknown>(url: string, o: RequestOptions): Promise<HttpResult<T>> {
    const method = o.method ?? "GET";
    const responseType = o.responseType ?? "json";
    const cacheable = method === "GET" && o.cacheTtlMs !== 0;
    const key = `${o.cacheScope ?? ""}|${responseType}|${url}`;
    if (cacheable) {
      const hit = this.opts.cache.get(key);
      if (hit) return { ...(hit as HttpResult<T>), fromCache: true };
    }

    let attempt = 0;
    for (;;) {
      try {
        const res = await this.once<T>(url, method, responseType, o);
        if (cacheable) this.opts.cache.set(key, res, o.cacheTtlMs);
        return res;
      } catch (err) {
        const e = err instanceof SourceError ? err : this.wrapNetworkError(err, o.source);
        const retryAfter = (e as SourceError & { retryAfterMs?: number }).retryAfterMs;
        if (!e.retryable || attempt >= this.opts.retries) throw e;
        const backoff = Math.min(8000, 300 * 2 ** attempt) + Math.floor(Math.random() * 200);
        const wait = retryAfter !== undefined ? Math.min(retryAfter, 10_000) : backoff;
        this.opts.logger.warn("reintentando petición", { source: o.source, url: redactUrl(url), attempt: attempt + 1, waitMs: wait, code: e.code });
        await this.sleep(wait);
        attempt++;
      }
    }
  }

  private async once<T>(url: string, method: string, responseType: ResponseType, o: RequestOptions): Promise<HttpResult<T>> {
    const headers: Record<string, string> = { "user-agent": this.opts.userAgent, ...o.headers };
    let body: string | undefined;
    if (o.body !== undefined) {
      body = JSON.stringify(o.body);
      headers["content-type"] ??= "application/json";
    }
    if (responseType === "json") headers["accept"] ??= "application/json";

    let current = url;
    let res: Response | undefined;
    const started = Date.now();
    for (let hop = 0; hop <= 5; hop++) {
      if (o.guardUrl) await o.guardUrl(new URL(current));
      res = await this.fetchImpl(current, {
        method,
        headers,
        body,
        redirect: o.guardUrl ? "manual" : "follow",
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      if (o.guardUrl && res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current).toString();
        continue;
      }
      break;
    }
    if (!res) throw new SourceError("internal", "Sin respuesta", "Reintenta.", true, o.source);
    if (res.status >= 300 && res.status < 400) {
      throw new SourceError("upstream_unavailable", "Demasiadas redirecciones", "Prueba con la URL final del recurso.", false, o.source);
    }

    this.opts.logger.debug("http", { source: o.source, url: redactUrl(current), status: res.status, ms: Date.now() - started });

    if (!res.ok) throw await this.httpError(res, o);

    const maxBytes = o.maxBytes ?? this.opts.maxBytes;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      throw new SourceError("too_large", `El recurso pesa ${(declared / 1e6).toFixed(1)} MB (máximo ${(maxBytes / 1e6).toFixed(0)} MB)`, "Busca una versión más liviana o aumenta MAX_DOWNLOAD_MB.", false, o.source);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new SourceError("too_large", `El recurso supera ${(maxBytes / 1e6).toFixed(0)} MB`, "Aumenta MAX_DOWNLOAD_MB o usa otra fuente.", false, o.source);
    }

    let parsed: unknown;
    if (responseType === "bytes") parsed = buf;
    else if (responseType === "text") parsed = buf.toString("utf8");
    else {
      const text = buf.toString("utf8");
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        throw new SourceError("upstream_unavailable", "La fuente devolvió una respuesta que no es JSON válido", "La API puede estar caída o haber cambiado; reintenta más tarde o usa otra fuente.", true, o.source);
      }
    }

    const hdrs: Record<string, string> = {};
    res.headers.forEach((v, k) => (hdrs[k] = v));
    return { status: res.status, url: current, contentType: res.headers.get("content-type") ?? "", headers: hdrs, body: parsed as T, fromCache: false };
  }

  private async httpError(res: Response, o: RequestOptions): Promise<SourceError> {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300).replace(/\s+/g, " ");
    } catch {}
    const status = res.status;
    const custom = o.hints?.[status];
    const retryAfterHeader = res.headers.get("retry-after");
    let retryAfterMs: number | undefined;
    if (retryAfterHeader) {
      const secs = Number(retryAfterHeader);
      retryAfterMs = Number.isFinite(secs) ? secs * 1000 : Math.max(0, Date.parse(retryAfterHeader) - Date.now());
    }
    let err: SourceError;
    if (status === 401 || status === 403) {
      err = new SourceError("auth", `Acceso denegado (${status}) por ${o.source}. ${detail}`, custom ?? `Revisa la credencial de ${o.source} en las variables de entorno.`, false, o.source);
    } else if (status === 404) {
      err = new SourceError("not_found", `No existe el recurso en ${o.source} (404).`, custom ?? "Verifica el identificador o búscalo primero con la tool buscar_* correspondiente.", false, o.source);
    } else if (status === 429) {
      err = new SourceError("rate_limited", `${o.source} limitó la frecuencia de consultas (429).`, custom ?? "Espera unos segundos y reintenta, o configura una API key para tener más cuota.", true, o.source);
    } else if (status >= 500 || RETRYABLE.has(status)) {
      err = new SourceError("upstream_unavailable", `${o.source} no está disponible (${status}).`, custom ?? "Es un problema de la fuente; reintenta más tarde o usa otra fuente.", true, o.source);
    } else {
      err = new SourceError("invalid_input", `${o.source} rechazó la consulta (${status}): ${detail}`, custom ?? "Revisa los parámetros de la consulta.", false, o.source);
    }
    if (retryAfterMs !== undefined) Object.assign(err, { retryAfterMs });
    return err;
  }

  private wrapNetworkError(err: unknown, source: string): SourceError {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      return new SourceError("timeout", `${source} no respondió a tiempo.`, "Reintenta más tarde o reduce el alcance de la consulta.", true, source);
    }
    return new SourceError("network", `Error de red con ${source}: ${(err as Error)?.message ?? err}`, "Verifica la conexión a internet o el proxy; reintenta más tarde.", true, source);
  }
}

/** Removes credentials from URLs before logging. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:api_key|key|token|apikey)=)[^&]+/gi, "$1***");
}
