/**
 * Decision service — record + list explicit decisions.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §6
 *         (DecisionService in core services)
 *         agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md §5
 *         (record_decision action card type)
 *
 * A decision is an explicit "we decided X because Y" record. Distinct from
 * an event: events narrate state changes, decisions narrate reasoning.
 *
 * Sources:
 *   ai_pm   — the AI PM proposed a decision via an applied action card
 *   user    — the user recorded a decision directly via the UI
 *   review  — a review produced a decision-level conclusion
 *
 * Decisions are append-only in v1.
 */
import {
  type DbClient,
  type ActorContext,
  type Decision,
  type DecisionSource,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapDecision } from "../mappers";
import { ValidationError } from "../errors";

export interface DecisionService {
  record(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: RecordDecisionInput,
  ): Promise<Decision>;
  list(
    db: DbClient,
    workspaceId: string,
    filter?: { projectId?: string; featureId?: string },
  ): Promise<Decision[]>;
}

export interface RecordDecisionInput {
  projectId?: string;
  featureId?: string;
  decisionText: string;
  rationale?: string;
  source: DecisionSource;
  linkedActionId?: string;
  linkedWeeklyReviewId?: string;
}

export const decisionService: DecisionService = {
  async record(db, actor, workspaceId, input) {
    if (!input.decisionText?.trim()) {
      throw new ValidationError("decision_text is required");
    }
    if (input.decisionText.length > 1000) {
      throw new ValidationError("decision_text must be ≤ 1000 characters");
    }
    if (input.rationale && input.rationale.length > 2000) {
      throw new ValidationError("rationale must be ≤ 2000 characters");
    }

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      input.projectId ?? null,
      input.featureId ?? null,
      input.decisionText,
      input.rationale ?? null,
      input.source,
      input.linkedActionId ?? null,
      input.linkedWeeklyReviewId ?? null,
      actor.id ?? null,
    ];

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId,
        featureId: input.featureId,
        entityType: "decision",
        entityId: id,
        eventType: "decision.recorded",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          decisionText: input.decisionText,
          rationale: input.rationale ?? null,
          source: input.source,
          linkedActionId: input.linkedActionId ?? null,
          linkedWeeklyReviewId: input.linkedWeeklyReviewId ?? null,
        },
      },
      () => [
        {
          sql: `INSERT INTO decisions
            (id, workspace_id, project_id, feature_id, decision_text, rationale,
             source, linked_action_id, linked_weekly_review_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM decisions WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("decision insert failed");
    return mapDecision(row);
  },

  async list(db, workspaceId, filter) {
    if (filter?.featureId) {
      const rows = await db.all<Record<string, unknown>>(
        "SELECT * FROM decisions WHERE workspace_id = ? AND feature_id = ? ORDER BY created_at DESC",
        [workspaceId, filter.featureId],
      );
      return rows.map(mapDecision);
    }
    if (filter?.projectId) {
      const rows = await db.all<Record<string, unknown>>(
        "SELECT * FROM decisions WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC",
        [workspaceId, filter.projectId],
      );
      return rows.map(mapDecision);
    }
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM decisions WHERE workspace_id = ? ORDER BY created_at DESC",
      [workspaceId],
    );
    return rows.map(mapDecision);
  },
};
