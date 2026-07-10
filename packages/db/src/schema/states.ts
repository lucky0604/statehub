/**
 * states table — work item states for a project.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2.1
 *         agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §10
 *
 * Seeded with 6 defaults on project create:
 *   Backlog (backlog), Todo (unstarted), In Progress (started),
 *   In Review (started), Done (completed), Dropped (cancelled)
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const STATUS_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

export type StatusGroup = (typeof STATUS_GROUPS)[number];

export const states = sqliteTable(
  "states",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    statusGroup: text("status_group", { enum: STATUS_GROUPS }).notNull(),
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
    uniqueIndex("idx_states_project_name")
      .on(table.projectId, table.name)
      .where(sql`deleted_at IS NULL`),
    index("idx_states_project_sort").on(table.projectId, table.sortOrder),
  ],
);

export type State = typeof states.$inferSelect;
export type NewState = typeof states.$inferInsert;
