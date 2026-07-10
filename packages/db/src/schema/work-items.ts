/**
 * work_items table — the primary execution unit.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2, §4, §5
 *         agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2.2
 *
 * Sequence ID:
 *   - sequence_id is unique within project (partial unique where deleted_at IS NULL)
 *   - assigned atomically from project_counters in the same batch as the insert
 *   - never reused after delete
 *   - displayed as ${project_identifier}-${sequence_id} (e.g. KAVIS-1)
 *
 * status_group is derived from the linked state's status_group at write time.
 * This denormalization lets list/kanban queries filter by status_group without
 * joining to states.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { STATUS_GROUPS } from "./states";

export const WORK_ITEM_TYPES = [
  "issue",
  "task",
  "bug",
  "enhancement",
  "note",
] as const;

export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
] as const;

export type Priority = (typeof PRIORITIES)[number];

export const CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
  "none",
] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const WORK_ITEM_SOURCES = [
  "user",
  "remote_mcp",
  "local_mcp",
  "import",
  "system_worker",
  "ai_pm",
] as const;

export type WorkItemSource = (typeof WORK_ITEM_SOURCES)[number];

export const workItems = sqliteTable(
  "work_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    featureId: text("feature_id"),
    parentWorkItemId: text("parent_work_item_id"),
    sequenceId: integer("sequence_id").notNull(),
    projectIdentifier: text("project_identifier").notNull(),
    title: text("title").notNull(),
    descriptionMarkdown: text("description_markdown"),
    stateId: text("state_id"),
    statusGroup: text("status_group", { enum: STATUS_GROUPS }).notNull().default("backlog"),
    type: text("type", { enum: WORK_ITEM_TYPES }).notNull().default("task"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("none"),
    source: text("source", { enum: WORK_ITEM_SOURCES }).notNull().default("user"),
    confidence: text("confidence", { enum: CONFIDENCE_LEVELS }).notNull().default("none"),
    startDate: integer("start_date"),
    targetDate: integer("target_date"),
    completedAt: integer("completed_at"),
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
    uniqueIndex("idx_work_items_project_sequence")
      .on(table.projectId, table.sequenceId)
      .where(sql`deleted_at IS NULL`),
    index("idx_work_items_ws_project_state").on(
      table.workspaceId,
      table.projectId,
      table.stateId,
    ),
    index("idx_work_items_ws_project_feature").on(
      table.workspaceId,
      table.projectId,
      table.featureId,
    ),
    index("idx_work_items_ws_project_priority").on(
      table.workspaceId,
      table.projectId,
      table.priority,
    ),
    index("idx_work_items_ws_project_updated").on(
      table.workspaceId,
      table.projectId,
      table.updatedAt,
    ),
  ],
);

export type WorkItem = typeof workItems.$inferSelect;
export type NewWorkItem = typeof workItems.$inferInsert;
