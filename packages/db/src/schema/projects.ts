/**
 * projects table — workspace-scoped project container.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2, §3, §4
 *         agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2
 *
 * identifier: 3-6 char uppercase code (KAVIS, SH, TF) used in work item IDs (KAVIS-1).
 * Partial unique on (workspace_id, slug) and (workspace_id, identifier).
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    identifier: text("identifier").notNull(),
    defaultStateId: text("default_state_id"),
    defaultAssigneeId: text("default_assignee_id"),
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
    uniqueIndex("idx_projects_ws_slug")
      .on(table.workspaceId, table.slug)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("idx_projects_ws_identifier")
      .on(table.workspaceId, table.identifier)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
