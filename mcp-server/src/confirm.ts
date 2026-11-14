import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SourceError } from "./errors.js";

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(",")}}`;
}

/**
 * Two-step confirmation for write tools.
 * A token is an HMAC over (tool, exact arguments, expiry); it is single-use and expires.
 * Any change in the arguments between preview and execution invalidates it.
 */
export class Confirmations {
  private used = new Map<string, number>();

  constructor(
    private readonly secret: Buffer = randomBytes(32),
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  private sign(tool: string, args: unknown, exp: number): string {
    return createHmac("sha256", this.secret).update(`${tool}\n${exp}\n${canonicalJson(args)}`).digest("base64url");
  }

  issue(tool: string, args: unknown): { token_confirmacion: string; expira_en: string } {
    const exp = this.now() + this.ttlMs;
    return { token_confirmacion: `${exp}.${this.sign(tool, args, exp)}`, expira_en: new Date(exp).toISOString() };
  }

  verify(tool: string, args: unknown, token: string): void {
    const [expStr, sig] = token.split(".");
    const exp = Number(expStr);
    const fail = (msg: string) => new SourceError("confirmation_required", msg, "Vuelve a llamar la tool SIN token_confirmacion para obtener una vista previa y un token nuevo; muéstrale la vista previa al usuario y pide su aprobación explícita.");
    if (!sig || !Number.isFinite(exp)) throw fail("Token de confirmación con formato inválido.");
    if (exp < this.now()) throw fail("El token de confirmación expiró.");
    const expected = Buffer.from(this.sign(tool, args, exp));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw fail("El token no corresponde a estos argumentos (¿cambiaste algún dato desde la vista previa?).");
    for (const [t, e] of this.used) if (e < this.now()) this.used.delete(t);
    if (this.used.has(token)) throw fail("Este token ya se usó.");
    this.used.set(token, exp);
  }
}
