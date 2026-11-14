export type ErrorCode =
  | "invalid_input"
  | "not_found"
  | "auth"
  | "rate_limited"
  | "upstream_unavailable"
  | "timeout"
  | "network"
  | "blocked_url"
  | "too_large"
  | "unsupported"
  | "source_disabled"
  | "writes_disabled"
  | "confirmation_required"
  | "internal";

/**
 * Error with a message meant for the AI agent: what happened AND what to do next.
 */
export class SourceError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly hint: string,
    public readonly retryable = false,
    public readonly source?: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export function toSourceError(err: unknown, source?: string): SourceError {
  if (err instanceof SourceError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new SourceError("internal", msg, "Error inesperado. Reintenta una vez; si persiste, usa otra fuente.", false, source);
}

export function formatError(err: SourceError): string {
  const src = err.source ? ` (${err.source})` : "";
  return `ERROR [${err.code}]${src}: ${err.message}\nQué hacer: ${err.hint}`;
}
