/**
 * ai_pm_action_cards table — proposed AI PM actions awaiting user decision.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md
 *         §5 (action cards), §8 (safety rules)
 *
 * The AI PM never writes project state directly. It produces action cards
 * that the user applies, edits, or dismisses. Each card carries a typed
 * payload validated against the action schema in packages/ai.
 *
 * Lifecycle:
 *   pending → applied    (user clicked Apply; underlying domain write ran)
 *   pending → dismissed  (user clicked Dismiss; high-risk requires a reason)
 *
 * A card is scoped to one ai_pm_query_id (the query that produced it).
 * Multiple cards from one query share the query_id; the UI groups them.
 *
 * High-risk action types (requires_confirmation=1) need an explicit
 * confirmation modal before apply. The list of high-risk types lives in
 * packages/ai/action-schema.ts; this table records the flag denormalized
 * so historical cards remain queryable even if the schema changes.
 *
 * edit_count tracks how many times the user edited the payload before
 * applying. Applied/dismissed cards are immutable after the decision.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ACTION_CARD_STATUSES = [
  "pending",
  "applied",
  "dismissed",
] as const;

export type ActionCardStatus = (typeof ACTION_CARD_STATUSES)[number];

export const aiPmActionCards = sqliteTable(
  "ai_pm_action_cards",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id"),
    featureId: text("feature_id"),
    aiPmQueryId: text("ai_pm_query_id").notNull(),
    actionType: text("action_type").notNull(),
    title: text("title").notNull(),
    reason: text("reason"),
    risk: text("risk"),
    requiresConfirmation: integer("requires_confirmation").notNull().default(0),
    payloadJson: text("payload_json").notNull(),
    status: text("status", { enum: ACTION_CARD_STATUSES })
      .notNull()
      .default("pending"),
    editCount: integer("edit_count").notNull().default(0),
    appliedAt: integer("applied_at"),
    appliedBy: text("applied_by"),
    dismissedAt: integer("dismissed_at"),
    dismissedBy: text("dismissed_by"),
    dismissReason: text("dismiss_reason"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("idx_ai_pm_cards_workspace_status").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    index("idx_ai_pm_cards_query").on(table.workspaceId, table.aiPmQueryId),
    index("idx_ai_pm_cards_feature").on(table.workspaceId, table.featureId),
  ],
);

export type AiPmActionCard = typeof aiPmActionCards.$inferSelect;
export type NewAiPmActionCard = typeof aiPmActionCards.$inferInsert;
