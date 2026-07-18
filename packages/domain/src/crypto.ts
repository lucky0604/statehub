/**
 * AES-256-GCM encryption for provider tokens stored in
 * `integrations.config_json`. Encrypts per secret field (pat,
 * api_token, api_key) with a key from STATEHUB_INTEGRATION_KEY.
 *
 * Stored format: `enc:v1:<base64(iv || tag || ciphertext)>`.
 * The `enc:v1:` prefix lets `decryptSecret` detect and pass through
 * legacy plaintext values (lazy migration, no schema bump).
 *
 * Source: agent_flow/implementation/v1/iterations/20260718-p07d-token-encryption/plan.md §3.1
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export interface CryptoOpts {
  keyB64?: string;
}

export class CryptoError extends Error {
  readonly code: "crypto_key_missing" | "crypto_decrypt_failed";
  constructor(code: "crypto_key_missing" | "crypto_decrypt_failed", message: string) {
    super(message);
    this.code = code;
    this.name = "CryptoError";
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string, opts?: CryptoOpts): string {
  const key = resolveKey(opts);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const bundle = Buffer.concat([iv, tag, ct]).toString("base64");
  return PREFIX + bundle;
}

export function decryptSecret(stored: string, opts?: CryptoOpts): string {
  if (!isEncrypted(stored)) return stored;
  const key = resolveKey(opts);
  const bundle = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (bundle.length < IV_LEN + TAG_LEN) {
    throw new CryptoError("crypto_decrypt_failed", "ciphertext too short");
  }
  const iv = bundle.subarray(0, IV_LEN);
  const tag = bundle.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = bundle.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new CryptoError("crypto_decrypt_failed", "decryption failed (tampered or wrong key)");
  }
}

function resolveKey(opts?: CryptoOpts): Buffer {
  const keyB64 = opts?.keyB64 ?? process.env.STATEHUB_INTEGRATION_KEY;
  if (!keyB64) {
    throw new CryptoError("crypto_key_missing", "STATEHUB_INTEGRATION_KEY is not set");
  }
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== KEY_LEN) {
    throw new CryptoError(
      "crypto_key_missing",
      `STATEHUB_INTEGRATION_KEY must be ${KEY_LEN} bytes, got ${key.length}`,
    );
  }
  return key;
}

export function generateKeyB64(): string {
  return randomBytes(KEY_LEN).toString("base64");
}
