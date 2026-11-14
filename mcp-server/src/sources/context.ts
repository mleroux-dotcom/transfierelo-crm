import type { Config } from "../config.js";
import type { HttpClient } from "../http.js";
import type { Logger } from "../logger.js";

export interface SourceContext {
  cfg: Config;
  http: HttpClient;
  logger: Logger;
}

export const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  return sp.toString();
};
