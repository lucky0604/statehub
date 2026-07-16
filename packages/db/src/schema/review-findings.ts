/**
 * review_findings table — one row per structured finding inside a review.
 *
 * Source: agent_flow/implementation/v1/phases/phase-03-review-ledger-loop.md §3.2, §6
 *
 * Findings are the structured unit of "what the reviewer wants changed." Each
 * has a severity, a file+line range, an optional suggestion, and a status
 * that flows through a small state machine (phase-03 §6):
 *
 *   open → accepted
 *   accepted → fixed
 *   open → dismissed
 *   fixed → reopened
 *   dismissed → reopened
 *
 * Dismiss requires a reason + actor (phase-03 §6 rule "Dismiss requires").
 * blocker/high findings drive Done Gate v1 (P03B): open blocker/high blocks
 * done. Dismissed blocker/high still requires reason/actor for accountability.
 *
 * linked_work_item_id / linked_todo_id: set when create_followup_todos_from_review
 * creates a review_fix work item (or a todo) for this finding. The link is
 * 1:1 — re-running the followup tool skips already-linked findings.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const FINDING_SEVERITIES = [
  "blocker",
  "high",
  "medium",
  "low",
  "nit",
] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_STATUSES = [
  "open",
  "accepted",
  "fixed",
  "dismissed",
  "wontfix",
  "reopened",
] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const reviewFindings = sqliteTable(
  "review_findings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    reviewId: text("review_id").notNull(),
    projectId: text("project_id").notNull(),
    featureId: text("feature_id"),
    workItemId: text("work_item_id"),
    severity: text("severity", { enum: FINDING_SEVERITIES }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    filePath: text("file_path"),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    suggestion: text("suggestion"),
    status: text("status", { enum: FINDING_STATUSES })
      .notNull()
      .default("open"),
    linkedWorkItemId: text("linked_work_item_id"),
    linkedTodoId: text("linked_todo_id"),
    dismissedReason: text("dismissed_reason"),
    dismissedBy: text("dismissed_by"),
    dismissedAt: integer("dismissed_at"),
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
    index("idx_findings_workspace_project").on(table.workspaceId, table.projectId),
    index("idx_findings_review").on(table.workspaceId, table.reviewId),
    index("idx_findings_feature").on(table.workspaceId, table.featureId),
    index("idx_findings_work_item").on(table.workspaceId, table.workItemId),
    index("idx_findings_linked_work_item").on(
      table.workspaceId,
      table.linkedWorkItemId,
    ),
    index("idx_findings_linked_todo").on(table.workspaceId, table.linkedTodoId),
    index("idx_findings_workspace_severity_status").on(
      table.workspaceId,
      table.severity,
      table.status,
    ),
  ],
);

export type ReviewFinding = typeof reviewFindings.$inferSelect;
export type NewReviewFinding = typeof reviewFindings.$inferInsert;
