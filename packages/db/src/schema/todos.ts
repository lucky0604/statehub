/**
 * todos table — checklist items under a work item / feature / agent run.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §3.2, §4.0
 *
 * Todos are NOT primary planning entities. Per the Work Item-Backed Agent Rule:
 * agent-created tasks that affect scope/schedule/completion must be work items;
 * todos are implementation subtasks, checklists, and ephemeral execution notes.
 * The UI must not count todo completion as feature completion.
 *
 * status: backlog -> in_progress -> done | cancelled.
 * evidence_required: if 1, done requires an evidence_summary (enforced in service).
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { PRIORITIES, CONFIDENCE_LEVELS, WORK_ITEM_SOURCES } from "./work-items";

export const TODO_STATUSES = ["backlog", "in_progress", "done", "cancelled"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_TYPES = ["implementation", "checklist", "verification", "note"] as const;
export type TodoType = (typeof TODO_TYPES)[number];

export const todos = sqliteTable(
  "todos",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    featureId: text("feature_id"),
    workItemId: text("work_item_id"),
    agentRunId: text("agent_run_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: TODO_STATUSES }).notNull().default("backlog"),
    type: text("type", { enum: TODO_TYPES }).notNull().default("implementation"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("none"),
    source: text("source", { enum: WORK_ITEM_SOURCES }).notNull().default("remote_mcp"),
    confidence: text("confidence", { enum: CONFIDENCE_LEVELS }).notNull().default("none"),
    evidenceRequired: integer("evidence_required").notNull().default(0),
    evidenceSummary: text("evidence_summary"),
    sortOrder: integer("sort_order").notNull().default(0),
    completedAt: integer("completed_at"),
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
    index("idx_todos_workspace_project").on(table.workspaceId, table.projectId),
    index("idx_todos_work_item").on(table.workspaceId, table.workItemId),
    index("idx_todos_feature").on(table.workspaceId, table.featureId),
    index("idx_todos_agent_run").on(table.workspaceId, table.agentRunId),
  ],
);

export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
