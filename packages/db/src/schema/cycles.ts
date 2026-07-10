/**
 * cycles table — time-boxed groupings of work items within a project.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2
 *
 * P01B creates the table + minimal service (create/list). The cycle_work_items
 * join and cycle-scoped Kanban/list filtering land in a later iteration; the
 * `cycle` URL key is reserved (url-state.ts) for that.
 *
 * Name is unique within project among non-deleted cycles.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const CYCLE_STATUSES = ["active", "completed"] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const cycles = sqliteTable(
  "cycles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: CYCLE_STATUSES }).notNull().default("active"),
    startDate: integer("start_date"),
    endDate: integer("end_date"),
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
    uniqueIndex("idx_cycles_project_name")
      .on(table.projectId, table.name)
      .where(sql`deleted_at IS NULL`),
    index("idx_cycles_project").on(table.projectId, table.sortOrder),
  ],
);

export type Cycle = typeof cycles.$inferSelect;
export type NewCycle = typeof cycles.$inferInsert;
