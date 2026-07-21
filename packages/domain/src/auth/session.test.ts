/**
 * Session token unit tests — sign/verify round-trip, tamper detection,
 * expiry, format errors.
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §4.1
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { signSession, verifySession } from "./session";

const SECRET = "test-secret-32-bytes-base64-AAAA";
const NOW = 1_700_000_000_000;

describe("signSession / verifySession round-trip", () => {
  it("produces body.sig format", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    expect(token.split(".")).toHaveLength(2);
    const [body] = token.split(".");
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("verifies a token it signed", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    const payload = await verifySession(token, SECRET, NOW + 1000);
    expect(payload).not.toBeNull();
    expect(payload?.uid).toBe("user-1");
    expect(payload?.iat).toBe(NOW);
    expect(payload?.exp).toBe(NOW + 24 * 60 * 60 * 1000);
  });

  it("produces different tokens for same user across calls (iat differs)", async () => {
    const a = await signSession("user-1", SECRET, NOW);
    const b = await signSession("user-1", SECRET, NOW + 1);
    expect(a).not.toBe(b);
  });
});

describe("verifySession rejection paths", () => {
  it("rejects wrong signature", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    const [body] = token.split(".");
    const tampered = `${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(await verifySession(tampered, SECRET, NOW + 1000)).toBeNull();
  });

  it("rejects signature from a different secret", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    expect(await verifySession(token, "different-secret", NOW + 1000)).toBeNull();
  });

  it("rejects expired token", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    const afterExpiry = NOW + 24 * 60 * 60 * 1000 + 1;
    expect(await verifySession(token, SECRET, afterExpiry)).toBeNull();
  });

  it("accepts token at exactly exp boundary (not yet expired)", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    const atExpiry = NOW + 24 * 60 * 60 * 1000;
    expect(await verifySession(token, SECRET, atExpiry)).not.toBeNull();
  });

  it("rejects malformed token (no dot)", async () => {
    expect(await verifySession("just-a-string", SECRET, NOW)).toBeNull();
  });

  it("rejects malformed token (too many dots)", async () => {
    expect(await verifySession("a.b.c", SECRET, NOW)).toBeNull();
  });

  it("rejects empty string", async () => {
    expect(await verifySession("", SECRET, NOW)).toBeNull();
  });

  it("rejects body that is not valid JSON", async () => {
    const body = Buffer.from("not json").toString("base64url");
    const sig = randomBytes(32).toString("base64url");
    expect(await verifySession(`${body}.${sig}`, SECRET, NOW)).toBeNull();
  });
});
