/**
 * In-memory DB client factory — for tests and ephemeral scenarios.
 *
 * Creates a fresh `:memory:` SQLite database with the migration SQL replayed,
 * wrapped as a DbClient. No file on disk, fully isolated, no cleanup needed.
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbClient, SqlStmt, SqlBindValue } from "./db-client";

const _HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(_HERE, "../migrations");

/**
 * Build an in-memory DbClient with the schema applied by replaying the raw
 * migration SQL files in order.
 */
export function createInMemoryDb(): DbClient {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");

  for (const file of ["0000_initial_events.sql", "0001_core_tables.sql"]) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    raw.exec(sql);
  }

  return {
    async batch(stmts: SqlStmt[]): Promise<void> {
      const tx = raw.transaction(() => {
        for (const s of stmts) raw.prepare(s.sql).run(...(s.params ?? []));
      });
      tx();
    },
    async run(sql: string, params: SqlBindValue[] = []): Promise<void> {
      raw.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: SqlBindValue[] = []): Promise<T[]> {
      return raw.prepare(sql).all(...params) as T[];
    },
    async first<T>(sql: string, params: SqlBindValue[] = []): Promise<T | null> {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
  };
}
