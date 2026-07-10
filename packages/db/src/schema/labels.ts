/**
 * labels table — work item labels for a project.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2.1
 *
 * Seeded with 8 defaults on project create:
 *   feature, bug, docs, infra, ai, mcp, review-fix, release
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
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
    uniqueIndex("idx_labels_project_name")
      .on(table.projectId, table.name)
      .where(sql`deleted_at IS NULL`),
    index("idx_labels_project_sort").on(table.projectId, table.sortOrder),
  ],
);

export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;
