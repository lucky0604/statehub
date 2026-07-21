/**
 * Auth service smoke — password hashing, login, session token round-trip.
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §4.2
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import type { DbClient } from "@statehub/db";
import { authService, signSession, verifySession } from "@statehub/domain";

const SECRET = "test-auth-secret-32-bytes-base64-AAAA";

describe("authService", () => {
  let db: DbClient;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
  });

  it("hashes a password and verifies it", async () => {
    const hash = await authService.hashPassword("super-secret-123");
    expect(hash).not.toBe("super-secret-123");
    expect(await authService.verifyPassword("super-secret-123", hash)).toBe(true);
    expect(await authService.verifyPassword("wrong", hash)).toBe(false);
  });

  it("rejects short passwords", async () => {
    await expect(authService.hashPassword("short")).rejects.toThrow(/at least 8 characters/);
  });

  it("creates a user and strips passwordHash from the returned object", async () => {
    const user = await authService.createUser(db, {
      email: "Alice@Example.COM",
      name: "Alice",
      password: "super-secret-123",
    });
    expect(user.email).toBe("alice@example.com");
    expect(user.name).toBe("Alice");
    expect(user.id).toBeTruthy();
    expect("passwordHash" in user).toBe(false);
  });

  it("logs in with correct credentials and returns a session token", async () => {
    const result = await authService.login(db, "alice@example.com", "super-secret-123", SECRET);
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe("alice@example.com");
    expect(result?.token.split(".")).toHaveLength(2);

    const payload = await verifySession(result!.token, SECRET);
    expect(payload?.uid).toBe(result!.user.id);
  });

  it("rejects login with wrong password", async () => {
    const result = await authService.login(db, "alice@example.com", "wrong-password", SECRET);
    expect(result).toBeNull();
  });

  it("rejects login with unknown email", async () => {
    const result = await authService.login(db, "nobody@example.com", "whatever", SECRET);
    expect(result).toBeNull();
  });

  it("verifyToken returns the payload for a valid token", async () => {
    const token = await signSession("user-x", SECRET);
    const payload = await authService.verifyToken(token, SECRET);
    expect(payload?.uid).toBe("user-x");
  });

  it("verifyToken returns null for a tampered token", async () => {
    const token = await signSession("user-x", SECRET);
    const [body] = token.split(".");
    const tampered = `${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(await authService.verifyToken(tampered, SECRET)).toBeNull();
  });

  it("getUserById returns the user", async () => {
    const created = await authService.createUser(db, {
      email: "bob@example.com",
      name: "Bob",
      password: "another-secret-1",
    });
    const fetched = await authService.getUserById(db, created.id);
    expect(fetched?.email).toBe("bob@example.com");
    expect("passwordHash" in (fetched as object)).toBe(false);
  });

  it("getUserById returns null for unknown id", async () => {
    expect(await authService.getUserById(db, "does-not-exist")).toBeNull();
  });
});
