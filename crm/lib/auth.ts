// Runs in both the Edge middleware and Node, so it only uses Web Crypto.
export const SESSION_COOKIE = "crm_session";

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The session token is an HMAC of the password, so changing the password logs everyone out. */
export async function sessionToken(): Promise<string | null> {
  const password = process.env.CRM_PASSWORD;
  if (!password) return null;
  const secret = process.env.CRM_SECRET || password;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("crm-session:" + password));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function apiKeyFrom(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return headers.get("x-api-key");
}
