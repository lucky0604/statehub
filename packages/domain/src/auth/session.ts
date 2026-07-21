/**
 * Stateless session token — HMAC-SHA256 signed cookie.
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.2–3.3
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256(body))>`.
 * The signature is over the base64url body (not the raw JSON) so the
 * verifier re-derives the body string byte-for-byte before checking.
 *
 * Uses Web Crypto (`crypto.subtle`) so the same code runs in the Edge
 * runtime middleware and the Node.js runtime route handlers. Both
 * `signSession` and `verifySession` are async because SubtleCrypto is.
 *
 * Constant-time comparison is provided by SubtleCrypto itself — the
 * HMAC verify is a single `verify` call, not a manual compare.
 */
const COOKIE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SessionPayload {
  uid: string;
  iat: number;
  exp: number;
}

const subtle = globalThis.crypto.subtle;

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(
  userId: string,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const payload: SessionPayload = { uid: userId, iat: now, exp: now + COOKIE_TTL_MS };
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await subtle.sign("HMAC", key, new TextEncoder().encode(body) as BufferSource);
  return `${body}.${base64url(sig)}`;
}

export async function verifySession(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const body = parts[0]!;
  const sig = parts[1]!;
  const key = await hmacKey(secret);

  // base64url decode signature to bytes for verify.
  const sigBytes = base64urlToBytes(sig);
  const ok = await subtle.verify(
    "HMAC",
    key,
    sigBytes as BufferSource,
    new TextEncoder().encode(body) as BufferSource,
  );
  if (!ok) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(base64urlDecode(body)) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || now > payload.exp) return null;
  if (typeof payload.uid !== "string" || !payload.uid) return null;
  return payload;
}

function base64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
