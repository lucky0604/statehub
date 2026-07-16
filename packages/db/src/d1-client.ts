/**
 * D1-only DB client factory — for Cloudflare Workers.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §4
 *
 * The unified `getDb()` in db-client.ts lazy-imports the local better-sqlite3
 * client for Node dev. That better-sqlite3 dependency chain (native bindings,
 * node:fs/path) cannot ship in a Worker bundle. Workers instead call
 * `createD1Client(env.DB)` directly to get a DbClient backed purely by the D1
 * binding — no local-client, no better-sqlite3, no node:* in the graph.
 *
 * This is the ONLY entrypoint mcp-remote imports. The web app keeps using the
 * unified getDb() (which resolves to better-sqlite3 in `next dev`).
 */
import type { D1Database } from "@cloudflare/workers-types";
import type { DbClient, SqlBindValue, SqlStmt } from "./db-client";

/** Construct a DbClient backed by a D1Database binding. */
export function createD1Client(d1: D1Database): DbClient {
  return {
    async batch(stmts: SqlStmt[]) {
      const prepared = stmts.map((s) => d1.prepare(s.sql).bind(...(s.params ?? [])));
      await d1.batch(prepared);
    },
    async run(sql: string, params: SqlBindValue[] = []) {
      await d1.prepare(sql).bind(...params).run();
    },
    async all<T = Record<string, unknown>>(sql: string, params: SqlBindValue[] = []) {
      const r = await d1.prepare(sql).bind(...params).all();
      return (r.results ?? []) as T[];
    },
    async first<T = Record<string, unknown>>(sql: string, params: SqlBindValue[] = []) {
      const r = await d1.prepare(sql).bind(...params).first();
      return (r ?? null) as T | null;
    },
  };
}

export type { DbClient, SqlBindValue, SqlStmt } from "./db-client";
