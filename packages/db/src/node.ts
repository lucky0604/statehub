/**
 * Node-only DB entrypoint — the runtime bits that depend on better-sqlite3.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §4
 *
 * Importing `@statehub/db` (the main entry) must never pull better-sqlite3 or
 * node:* into a bundle — Cloudflare Workers import @statehub/domain, which
 * imports @statehub/db. So the main entry exports types + D1 + transaction +
 * schema only. This subpath (@statehub/db/node) exports the Node-only runtime:
 * getDb(), setDbClient(), the local better-sqlite3 client, and the in-memory
 * test factory. Use it from `next dev`, seed scripts, and tests only.
 */
export { getDb, setDbClient, type DbClient, type SqlStmt, type SqlBindValue } from "./db-client";
export { getLocalDb, getRawDb, hasLocalDb } from "./local-client";
export { createInMemoryDb } from "./test-db";
