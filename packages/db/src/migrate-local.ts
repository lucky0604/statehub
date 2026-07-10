/* eslint-disable no-console -- CLI script, console output is the point */
/**
 * Local migration runner — applies SQL migrations to the local SQLite file.
 *
 * Usage: pnpm db:migrate (runs this script)
 *
 * In production, use `wrangler d1 migrations apply --remote` instead.
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getLocalDb } from "./local-client";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _HERE = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(_HERE, "../migrations");

console.log("Applying migrations to local SQLite...");

try {
  const db = getLocalDb();
  migrate(db, { migrationsFolder });
  console.log("✓ Migrations applied successfully");
} catch (e) {
  console.error("✗ Migration failed:", e);
  process.exit(1);
}
