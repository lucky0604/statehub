/**
 * reviews table — one row per structured agent review.
 *
 * Source: agent_flow/implementation/v1/phases/phase-03-review-ledger-loop.md §3.1, §4.1, §6
 *
 * A review is what an agent (Codex/GPT/Gemini) returns when asked to review
 * a feature / work item / agent run. It carries a verdict, summary, and a
 * list of structured findings (separate table). The verdict drives feature
 * status automation (P03B): needs_changes + blocker/high findings → feature
 * needs_changes. Reviews are insert-only in v1 (no update path); agents
 * re-submit by creating a new review with a new id.
 *
 * Target scope: a review can target a feature, a work item, an agent run,
 * or a combination. project_id is always required. A project-only review
 * (no feature/work_item/agent_run) is allowed for informational verdicts.
 *
 * Verdicts (phase-03 §3.1):
 *   approved       — reviewer endorses the work
 *   needs_changes  — work is close but needs fixes
 *   blocked        — reviewer cannot proceed (missing context, broken build)
 *   informational  — FYI, no action required
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CONFIDENCE_LEVELS } from "./work-items";

export const REVIEW_VERDICTS = [
  "approved",
  "needs_changes",
  "blocked",
  "informational",
] as const;

export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    featureId: text("feature_id"),
    workItemId: text("work_item_id"),
    agentRunId: text("agent_run_id"),
    reviewer: text("reviewer").notNull(),
    model: text("model"),
    verdict: text("verdict", { enum: REVIEW_VERDICTS }).notNull(),
    summary: text("summary"),
    confidence: text("confidence", { enum: CONFIDENCE_LEVELS })
      .notNull()
      .default("none"),
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
    index("idx_reviews_workspace_project").on(table.workspaceId, table.projectId),
    index("idx_reviews_feature").on(table.workspaceId, table.featureId),
    index("idx_reviews_work_item").on(table.workspaceId, table.workItemId),
    index("idx_reviews_agent_run").on(table.workspaceId, table.agentRunId),
    index("idx_reviews_workspace_verdict_created").on(
      table.workspaceId,
      table.verdict,
      table.createdAt,
    ),
  ],
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
