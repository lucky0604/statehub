/**
 * Crypto helper unit tests — AES-256-GCM round-trip, legacy fallback,
 * tamper detection, key-missing errors.
 *
 * Source: agent_flow/implementation/v1/iterations/20260718-p07d-token-encryption/plan.md §4.1
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  generateKeyB64,
  CryptoError,
} from "./crypto";

const TEST_KEY = generateKeyB64();
const ORIGINAL_KEY = process.env.STATEHUB_INTEGRATION_KEY;

beforeAll(() => {
  process.env.STATEHUB_INTEGRATION_KEY = TEST_KEY;
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.STATEHUB_INTEGRATION_KEY;
  } else {
    process.env.STATEHUB_INTEGRATION_KEY = ORIGINAL_KEY;
  }
});

describe("encryptSecret / decryptSecret round-trip", () => {
  it("encrypts to enc:v1: prefix and decrypts back", () => {
    const ct = encryptSecret("ghp_secret123");
    expect(ct.startsWith("enc:v1:")).toBe(true);
    expect(ct).not.toContain("ghp_secret123");
    expect(decryptSecret(ct)).toBe("ghp_secret123");
  });

  it("different IVs per call → different ciphertexts for same plaintext", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("handles empty string", () => {
    const ct = encryptSecret("");
    expect(decryptSecret(ct)).toBe("");
  });

  it("handles unicode", () => {
    const ct = encryptSecret("token-with-üñïçødé");
    expect(decryptSecret(ct)).toBe("token-with-üñïçødé");
  });
});

describe("legacy plaintext fallback", () => {
  it("decryptSecret passes through non-prefixed values", () => {
    expect(decryptSecret("ghp_legacy_plaintext")).toBe("ghp_legacy_plaintext");
    expect(decryptSecret("plain")).toBe("plain");
  });

  it("isEncrypted distinguishes forms", () => {
    expect(isEncrypted("enc:v1:abc")).toBe(true);
    expect(isEncrypted("ghp_plain")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });
});

describe("tamper / wrong-key detection", () => {
  it("throws CryptoError on tampered ciphertext", () => {
    const ct = encryptSecret("ghp_x");
    const bundle = ct.slice("enc:v1:".length);
    const buf = Buffer.from(bundle, "base64");
    const last = buf.length - 1;
    buf[last] = (buf[last] ?? 0) ^ 0x01;
    const tampered = "enc:v1:" + buf.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow(CryptoError);
    expect(() => decryptSecret(tampered)).toThrow(/decryption failed/);
  });

  it("throws CryptoError with wrong key", () => {
    const ct = encryptSecret("ghp_x", { keyB64: TEST_KEY });
    const otherKey = generateKeyB64();
    expect(() => decryptSecret(ct, { keyB64: otherKey })).toThrow(CryptoError);
  });

  it("throws CryptoError on truncated bundle", () => {
    const truncated = "enc:v1:" + Buffer.from("short").toString("base64");
    expect(() => decryptSecret(truncated)).toThrow(/too short/);
  });
});

describe("key-missing errors", () => {
  beforeEach(() => {
    delete process.env.STATEHUB_INTEGRATION_KEY;
  });

  it("encryptSecret throws CryptoError when key missing", () => {
    expect(() => encryptSecret("x")).toThrow(CryptoError);
    expect(() => encryptSecret("x")).toThrow(/STATEHUB_INTEGRATION_KEY/);
  });

  it("decryptSecret throws CryptoError when key missing (only for encrypted values)", () => {
    expect(decryptSecret("plain")).toBe("plain");
    const ct = "enc:v1:" + Buffer.from("x").toString("base64");
    expect(() => decryptSecret(ct)).toThrow(CryptoError);
  });

  it("throws CryptoError when key is wrong length", () => {
    process.env.STATEHUB_INTEGRATION_KEY = Buffer.from("short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/must be 32 bytes/);
  });
});

describe("generateKeyB64", () => {
  it("returns 44-char base64 (32 bytes)", () => {
    const k = generateKeyB64();
    expect(k.length).toBe(44);
    expect(Buffer.from(k, "base64").length).toBe(32);
  });

  it("returns different keys per call", () => {
    expect(generateKeyB64()).not.toBe(generateKeyB64());
  });
});
