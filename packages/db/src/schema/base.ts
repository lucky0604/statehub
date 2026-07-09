/**
 * Base columns shared by mutable business tables.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2
 *
 * Rules (enforced by extending this helper, not by each table re-declaring):
 *   - id is text, globally unique, generated in app (uuid v4)
 *   - workspace_id is mandatory for workspace-scoped entities
 *   - deleted_at means soft-deleted (partial unique indexes use it)
 *   - version increments on every mutable update
 *   - created_at never changes; updated_at changes only on real state changes
 *
 * Append-only tables (events, idempotency_records) do NOT extend this helper.
 */
import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";

export const baseColumns = {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  deletedAt: integer("deleted_at"),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
} as const;

/**
 * Audit-only columns for tables that track who created/updated a row
 * but are NOT workspace-scoped (e.g. users). Use sparingly.
 */
export const auditedColumns = {
  id: text("id").primaryKey(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  deletedAt: integer("deleted_at"),
  version: integer("version").notNull().default(1),
} as const;
