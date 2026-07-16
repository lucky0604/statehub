/**
 * Unified DB client — abstracts over D1 (production) and better-sqlite3 (local dev).
 *
 * Why: `next dev` runs in Node.js without a worker context, so it can't see the
 * D1 binding. We point local dev at a SQLite file via better-sqlite3 instead.
 * Production runs in Cloudflare Workers with the D1 binding. The SQL is
 * SQLite-dialect and works on both.
 *
 * The interface is intentionally minimal: raw SQL + bound params. Drizzle's
 * prepared-statement types differ between D1 and better-sqlite3, so we go one
 * level down to keep services db-agnostic.
 */
import type { D1Database } from "@cloudflare/workers-types";
import type Database from "better-sqlite3";
import { createRequire } from "node:module";
import { getD1, hasD1 } from "./client";

/** Bindable SQLite value. Matches what both D1 and better-sqlite3 accept. */
export type SqlBindValue = null | string | number | boolean | Uint8Array;

/** A SQL statement with bound params. Used for batch operations. */
export interface SqlStmt {
  sql: string;
  params?: SqlBindValue[];
}

/**
 * Common DB interface. Both D1 and better-sqlite3 implementations satisfy this.
 * Methods are async to match D1's API (better-sqlite3 is sync but we wrap).
 */
export interface DbClient {
  /** Run multiple statements atomically. Either all commit or none. */
  batch(stmts: SqlStmt[]): Promise<void>;
  /** Run a single statement (INSERT/UPDATE/DELETE/DDL). */
  run(sql: string, params?: SqlBindValue[]): Promise<void>;
  /** Run a query and return all matching rows. */
  all<T = Record<string, unknown>>(sql: string, params?: SqlBindValue[]): Promise<T[]>;
  /** Run a query and return the first row, or null. */
  first<T = Record<string, unknown>>(sql: string, params?: SqlBindValue[]): Promise<T | null>;
}

// ─── D1 implementation ───────────────────────────────────────────────────────

class D1Client implements DbClient {
  constructor(private d1: D1Database) {}

  async batch(stmts: SqlStmt[]): Promise<void> {
    const prepared = stmts.map((s) => this.d1.prepare(s.sql).bind(...(s.params ?? [])));
    await this.d1.batch(prepared);
  }

  async run(sql: string, params: SqlBindValue[] = []): Promise<void> {
    await this.d1.prepare(sql).bind(...params).run();
  }

  async all<T>(sql: string, params: SqlBindValue[] = []): Promise<T[]> {
    const r = await this.d1.prepare(sql).bind(...params).all();
    return (r.results ?? []) as T[];
  }

  async first<T>(sql: string, params: SqlBindValue[] = []): Promise<T | null> {
    const r = await this.d1.prepare(sql).bind(...params).first();
    return (r as T | null) ?? null;
  }
}

// ─── Local (better-sqlite3) implementation ───────────────────────────────────

class LocalClient implements DbClient {
  constructor(private db: Database.Database) {}

  async batch(stmts: SqlStmt[]): Promise<void> {
    const tx = this.db.transaction(() => {
      for (const s of stmts) {
        this.db.prepare(s.sql).run(...(s.params ?? []));
      }
    });
    tx();
  }

  async run(sql: string, params: SqlBindValue[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async all<T>(sql: string, params: SqlBindValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async first<T>(sql: string, params: SqlBindValue[] = []): Promise<T | null> {
    return (this.db.prepare(sql).get(...params) as T | undefined) ?? null;
  }
}

// ─── Accessor ────────────────────────────────────────────────────────────────

let _client: DbClient | null = null;
let _override: DbClient | null = null;

/**
 * Inject a custom client (used in tests to pass a fully-controlled db).
 * Pass null to clear.
 */
export function setDbClient(client: DbClient | null): void {
  _override = client;
  _client = null;
}

/**
 * Get the active DB client.
 *
 * Resolution order:
 *   1. Test override (setDbClient)
 *   2. D1 binding (production / wrangler dev)
 *   3. Local better-sqlite3 (next dev)
 *
 * Caches the first resolution. Call setDbClient(null) to re-resolve.
 */
export function getDb(): DbClient {
  if (_override !== null) return _override;
  if (_client === null) {
    if (hasD1()) {
      _client = new D1Client(getD1());
    } else {
      // Lazy-require the local (better-sqlite3) client so it stays out of the
      // static module graph. This file is only on the runtime path in Node
      // (next dev, seed scripts); Cloudflare Workers use createD1Client() from
      // ./d1-client instead and never import getDb(). A static import would pull
      // better-sqlite3's native-binding deps (bindings, file-uri-to-path) into
      // the Worker bundle.
      const require = createRequire(import.meta.url);
      const localClient = require("./local-client") as {
        getRawDb: () => Database.Database;
      };
      _client = new LocalClient(localClient.getRawDb());
    }
  }
  return _client;
}
