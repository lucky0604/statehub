/**
 * decisions table — explicit recorded decisions, AI or user-originated.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §6
 *         (DecisionService in core services), §8 (AI writes through
 *         proposed decisions)
 *
 * A decision is an explicit "we decided X because Y" record. It is distinct
 * from an event: events narrate state changes, decisions narrate the
 * reasoning behind a state change (or a non-change — e.g. "we decided NOT
 * to pause project X this week").
 *
 * Sources:
 *   ai_pm   — the AI PM proposed a decision via an action card that the
 *             user applied (record_decision action type) or that the AI PM
 *             emitted inline in a weekly review
 *   user    — the user recorded a decision directly via the UI
 *   review  — a review produced a decision-level conclusion (e.g. "block
 *             release until X is fixed")
 *
 * linked_action_id ties a decision to the action card that produced it
 * (when source=ai_pm and the decision came from an applied card).
 * linked_weekly_review_id ties a decision to the weekly review it was
 * recorded against.
 *
 * Decisions are append-only in v1 (no update/delete path). To revise a
 * decision, record a new one that supersedes it (a `supersedes_id` field
 * is deferred to v2).
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const DECISION_SOURCES = ["ai_pm", "user", "review"] as const;

export type DecisionSource = (typeof DECISION_SOURCES)[number];

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id"),
    featureId: text("feature_id"),
    decisionText: text("decision_text").notNull(),
    rationale: text("rationale"),
    source: text("source", { enum: DECISION_SOURCES }).notNull(),
    linkedActionId: text("linked_action_id"),
    linkedWeeklyReviewId: text("linked_weekly_review_id"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by"),
  },
  (table) => [
    index("idx_decisions_workspace_project").on(
      table.workspaceId,
      table.projectId,
      table.createdAt,
    ),
    index("idx_decisions_workspace_feature").on(
      table.workspaceId,
      table.featureId,
      table.createdAt,
    ),
    index("idx_decisions_action").on(table.workspaceId, table.linkedActionId),
  ],
);

export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
