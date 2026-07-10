/**
 * workspaces table — top-level tenant boundary.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2, §3
 *         agent_flow/implementation/v1/04-security-auth-permissions.md §3
 *
 * Every entity below this is workspace-scoped. workspace_id on every other
 * table MUST reference this table's id.
 *
 * Soft-delete: partial unique index on slug WHERE deleted_at IS NULL, so a
 * soft-deleted workspace slug can be reused.
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
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
  },
  (table) => [
    uniqueIndex("idx_workspaces_slug").on(table.slug).where(sql`deleted_at IS NULL`),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
