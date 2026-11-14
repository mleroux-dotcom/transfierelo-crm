/**
 * Structured JSON logger that writes ONLY to stderr.
 * stdout is reserved for the MCP stdio protocol; writing there would corrupt it.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

const SECRET_KEYS = /token|key|secret|password|authorization/i;

function redact(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = SECRET_KEYS.test(k) ? "[redactado]" : v;
  return out;
}

export function createLogger(level: LogLevel = "info", write: (line: string) => void = (l) => process.stderr.write(l)): Logger {
  const min = LEVELS[level];
  const log = (lvl: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (LEVELS[lvl] < min) return;
    const entry = { ts: new Date().toISOString(), level: lvl, msg, ...(data ? redact(data) : {}) };
    write(JSON.stringify(entry) + "\n");
  };
  return {
    debug: (m, d) => log("debug", m, d),
    info: (m, d) => log("info", m, d),
    warn: (m, d) => log("warn", m, d),
    error: (m, d) => log("error", m, d),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
