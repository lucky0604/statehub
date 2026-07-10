/**
 * Local SQLite client for development.
 *
 * Production uses Cloudflare D1 (accessed via env binding).
 * Local dev uses better-sqlite3 pointing at a local file — this lets
 * `next dev` read/write data without needing wrangler's worker context.
 *
 * The migration SQL is SQLite-dialect and works on both better-sqlite3 and D1.
 *
 * IMPORTANT: better-sqlite3 is a native addon. We load it via Node's real
 * `require` (bypassing webpack) so its internal `bindings` require resolves
 * the `.node` file correctly. A static `import` would let webpack bundle it
 * and break the native binding lookup.
 *
 * Loader support across environments:
 *   - Next.js (webpack): uses `__non_webpack_require__`
 *   - tsx / plain CJS:   uses the global `require`
 *   - pure ESM:          uses `createRequire(import.meta.url)`
 */
import type { Database as DatabaseType } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as schema from "./schema/index";

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _raw: DatabaseType | null = null;
let _BetterSqlite: DatabaseConstructor | null = null;

declare const __non_webpack_require__: NodeRequire | undefined;

/**
 * Node's real `require`, bypassing webpack's module interception.
 *
 * `__non_webpack_require__` is a webpack-recognized escape hatch that compiles
 * to the real `require`. Outside webpack (tsx, plain CJS) the global `require`
 * is used. Pure ESM falls back to `createRequire(import.meta.url)`.
 */
function nodeRequire(): NodeRequire {
  if (typeof __non_webpack_require__ === "function") return __non_webpack_require__;
  if (typeof require === "function") return require;
  const url =
    typeof import.meta !== "undefined" ? String(import.meta.url) : `file://${process.cwd()}/`;
  return createRequire(url);
}

type DatabaseConstructor = new (
  filename: string,
  options?: { nativeBinding?: string; readonly?: boolean; fileMustExist?: boolean },
) => DatabaseType;

/**
 * Lazily load better-sqlite3. MUST stay lazy — loading at module top level would
 * crash in production (Cloudflare Workers has no better-sqlite3 native binding),
 * where this module is still imported (transitively via db-client.ts) even though
 * `getRawDb()` is never called there.
 */
function getBetterSqlite(): DatabaseConstructor {
  if (_BetterSqlite === null) {
    _BetterSqlite = nodeRequire()("better-sqlite3") as DatabaseConstructor;
  }
  return _BetterSqlite;
}

/**
 * Walk up from cwd to find the monorepo root (marked by pnpm-workspace.yaml).
 * `next dev` runs from apps/web, `pnpm db:migrate` runs from packages/db —
 * both need to resolve the same packages/db/local.db path.
 */
function findMonorepoRoot(): string {
  let cwd = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return cwd;
    const parent = dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  return process.cwd();
}

const MONOREPO_ROOT = findMonorepoRoot();
const DB_PATH = resolve(MONOREPO_ROOT, "packages/db/local.db");

/**
 * Get the drizzle instance backed by better-sqlite3.
 * Opens once, caches. Safe to call from any server module.
 */
export function getLocalDb(): BetterSQLite3Database<typeof schema> {
  if (_db === null) {
    const raw = new (getBetterSqlite())(DB_PATH);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    _raw = raw;
    _db = drizzle(raw, { schema });
  }
  return _db;
}

/**
 * Get the raw better-sqlite3 instance (for migrations, pragma, etc).
 */
export function getRawDb(): DatabaseType {
  if (_raw === null) {
    getLocalDb();
  }
  return _raw!;
}

/**
 * True if the local DB file exists.
 */
export function hasLocalDb(): boolean {
  return existsSync(DB_PATH);
}
