/**
 * weekly_reviews table — saved weekly review summaries.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md
 *         §3.4 (weekly review mode), §6.3 (weekly review UI)
 *
 * A weekly review is a structured snapshot of the workspace (or a single
 * project) for a week window. It is produced by the AI PM's weekly_review
 * mode and saved by the user via the save_weekly_review action card.
 *
 * summary_json shape (validated client-side against the weekly review
 * answer schema in packages/ai):
 *   {
 *     "completed":   [{ entity_type, entity_id, title, completed_at }],
 *     "stalled":     [{ entity_type, entity_id, title, last_activity_at }],
 *     "open_risks":  [{ description, severity, linked_entity_id }],
 *     "missing_evidence": [{ feature_id, description }],
 *     "next_week_focus": [{ entity_type, entity_id, title, rationale }],
 *     "pause_recommendations": [{ project_id, rationale, suggested_action }]
 *   }
 *
 * project_id is nullable: a cross-project review covers the whole workspace.
 *
 * Reviews are append-only in v1. Re-running weekly review for the same
 * week creates a new row; the UI shows the most recent by created_at.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const weeklyReviews = sqliteTable(
  "weekly_reviews",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id"),
    weekStart: integer("week_start").notNull(),
    weekEnd: integer("week_end").notNull(),
    summaryJson: text("summary_json").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by"),
  },
  (table) => [
    index("idx_weekly_reviews_workspace_week").on(
      table.workspaceId,
      table.weekStart,
    ),
    index("idx_weekly_reviews_workspace_project").on(
      table.workspaceId,
      table.projectId,
      table.createdAt,
    ),
  ],
);

export type WeeklyReview = typeof weeklyReviews.$inferSelect;
export type NewWeeklyReview = typeof weeklyReviews.$inferInsert;
