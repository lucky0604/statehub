/**
 * features table — deliverable groupings under a project.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2
 *         agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §10
 *
 * status state machine:
 *   backlog -> planned -> in_progress -> needs_review -> done
 *   needs_review -> needs_changes -> in_progress
 *   done -> reopened
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const FEATURE_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "needs_review",
  "needs_changes",
  "done",
  "reopened",
] as const;

export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const features = sqliteTable(
  "features",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: FEATURE_STATUSES }).notNull().default("backlog"),
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
    uniqueIndex("idx_features_project_name")
      .on(table.projectId, table.name)
      .where(sql`deleted_at IS NULL`),
    index("idx_features_project_sort").on(table.projectId, table.sortOrder),
    index("idx_features_workspace_project").on(table.workspaceId, table.projectId),
  ],
);

export type Feature = typeof features.$inferSelect;
export type NewFeature = typeof features.$inferInsert;
