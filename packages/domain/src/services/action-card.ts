/**
 * Action card service — persist + list + apply + dismiss + edit the AI PM's
 * proposed actions.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md §5, §8
 *
 * The AI PM never writes project state directly. It proposes action cards;
 * the user applies, edits, or dismisses them. This service is the bridge:
 *   - create()    persists cards from an AI PM response
 *   - apply()     validates + executes the underlying domain write +
 *                 flips status to 'applied' + emits ai_pm.action_applied
 *   - dismiss()   flips status to 'dismissed' + emits ai_pm.action_dismissed
 *   - edit()      updates the payload (still pending) + increments edit_count
 *
 * Safety (§8):
 *   - apply() re-validates the payload via action-validators before executing
 *   - high-risk actions require confirmHighRisk=true at the API layer; the
 *     service trusts the API layer to enforce this (it's a UI concern as
 *     much as a backend one)
 *   - mark_feature_done runs the Done Gate via the validator; blocked →
 *     DoneGateBlockedError
 *   - Already-applied/dismissed cards cannot be re-applied (409 conflict)
 */
import {
  type DbClient,
  type ActorContext,
  type AiPmActionCard,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import {
  validateActionPayload,
  isHighRiskActionType,
  type ActionType,
  type ActionCardEnvelope,
  type CreateFeaturePayload,
  type CreateWorkItemPayload,
  type UpdateWorkItemPriorityPayload,
  type SetCurrentFocusPayload,
  type RecordDecisionPayload,
  type CreateReviewFixItemsPayload,
  type SaveWeeklyReviewPayload,
  type GenerateAgentPromptPayload,
  type PauseProjectPayload,
  type ArchiveProjectPayload,
  type DismissHighFindingPayload,
  type MarkFeatureDonePayload,
  type ChangePortfolioPriorityPayload,
} from "@statehub/ai";
import { mapAiPmActionCard } from "../mappers";
import { NotFoundError, ValidationError, ConflictError } from "../errors";
import { validateActionForApply } from "./action-validators";
import { featureService } from "./feature";
import { workItemService } from "./work-item";
import { projectService } from "./project";
import { reviewService } from "./review";
import { decisionService } from "./decision";
import { weeklyReviewService } from "./weekly-review";

export interface ActionCardService {
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    queryId: string,
    envelope: ActionCardEnvelope,
  ): Promise<AiPmActionCard>;
  list(
    db: DbClient,
    workspaceId: string,
    filter?: {
      status?: "pending" | "applied" | "dismissed";
      queryId?: string;
      featureId?: string;
      projectId?: string;
    },
  ): Promise<AiPmActionCard[]>;
  get(db: DbClient, workspaceId: string, actionId: string): Promise<AiPmActionCard | null>;
  apply(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    actionId: string,
    options?: { editedPayload?: unknown; confirmHighRisk?: boolean },
  ): Promise<{ card: AiPmActionCard; result: ApplyResult }>;
  dismiss(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    actionId: string,
    reason?: string,
  ): Promise<AiPmActionCard>;
  edit(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    actionId: string,
    editedPayload: unknown,
  ): Promise<AiPmActionCard>;
}

export type ApplyResult =
  | { kind: "create_feature"; featureId: string }
  | { kind: "create_work_item"; workItemId: string }
  | { kind: "update_work_item_priority"; workItemId: string }
  | { kind: "set_current_focus"; decisionId: string }
  | { kind: "record_decision"; decisionId: string }
  | { kind: "create_review_fix_items"; createdCount: number }
  | { kind: "save_weekly_review"; weeklyReviewId: string }
  | { kind: "generate_agent_prompt"; prompt: string }
  | { kind: "pause_project"; projectId: string }
  | { kind: "archive_project"; projectId: string }
  | { kind: "dismiss_high_finding"; findingId: string }
  | { kind: "mark_feature_done"; featureId: string }
  | { kind: "change_portfolio_priority"; projectId: string };

export const actionCardService: ActionCardService = {
  async create(db, actor, workspaceId, queryId, envelope) {
    // Re-validate the envelope server-side. The AI PM response was already
    // parsed, but a persisted card should never bypass schema validation.
    const payload = validateActionPayload(envelope.type, envelope.payload);

    const id = crypto.randomUUID();
    const requiresConfirmation = isHighRiskActionType(envelope.type) ? 1 : 0;
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      envelope.target.project_id ?? null,
      envelope.target.feature_id ?? null,
      queryId,
      envelope.type,
      envelope.title,
      envelope.reason ?? null,
      envelope.risk ?? null,
      requiresConfirmation,
      JSON.stringify(payload),
    ];

    await withEvent(
      db,
      {
        workspaceId,
        projectId: envelope.target.project_id,
        featureId: envelope.target.feature_id,
        entityType: "ai_pm_action_card",
        entityId: id,
        eventType: "ai_pm.action_card_created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          queryId,
          actionType: envelope.type,
          title: envelope.title,
          requiresConfirmation: requiresConfirmation === 1,
        },
      },
      () => [
        {
          sql: `INSERT INTO ai_pm_action_cards
            (id, workspace_id, project_id, feature_id, ai_pm_query_id,
             action_type, title, reason, risk, requires_confirmation, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM ai_pm_action_cards WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("action card insert failed");
    return mapAiPmActionCard(row);
  },

  async list(db, workspaceId, filter) {
    const conditions = ["workspace_id = ?"];
    const params: SqlBindValue[] = [workspaceId];
    if (filter?.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.queryId) {
      conditions.push("ai_pm_query_id = ?");
      params.push(filter.queryId);
    }
    if (filter?.featureId) {
      conditions.push("feature_id = ?");
      params.push(filter.featureId);
    }
    if (filter?.projectId) {
      conditions.push("project_id = ?");
      params.push(filter.projectId);
    }
    const sql = `SELECT * FROM ai_pm_action_cards WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;
    const rows = await db.all<Record<string, unknown>>(sql, params);
    return rows.map(mapAiPmActionCard);
  },

  async get(db, workspaceId, actionId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM ai_pm_action_cards WHERE id = ? AND workspace_id = ?",
      [actionId, workspaceId],
    );
    return row ? mapAiPmActionCard(row) : null;
  },

  async apply(db, actor, workspaceId, actionId, options) {
    const card = await actionCardService.get(db, workspaceId, actionId);
    if (!card) throw new NotFoundError("ai_pm_action_card", actionId);
    if (card.status !== "pending") {
      throw new ConflictError(`action card ${actionId} is already ${card.status}`);
    }

    // High-risk confirmation gate.
    if (isHighRiskActionType(card.actionType)) {
      if (!options?.confirmHighRisk) {
        throw new ValidationError(
          "high_risk_confirmation_required",
          { actionId, actionType: card.actionType },
        );
      }
    }

    // Use edited payload if provided, else the stored payload.
    const payloadToApply = options?.editedPayload ?? JSON.parse(card.payloadJson);

    // Re-validate against current DB state.
    await validateActionForApply(card.actionType as ActionType, {
      db,
      workspaceId,
      target: {
        project_id: card.projectId ?? undefined,
        feature_id: card.featureId ?? undefined,
      },
      payload: payloadToApply,
    });

    // Execute the underlying write.
    const result = await executeActionWrite(
      db,
      actor,
      workspaceId,
      card.actionType as ActionType,
      payloadToApply,
      {
        project_id: card.projectId ?? undefined,
        feature_id: card.featureId ?? undefined,
      },
    );

    // Flip status to applied + emit event.
    const params: SqlBindValue[] = [
      Date.now(),
      actor.id ?? null,
      "applied",
      actionId,
      workspaceId,
    ];
    await withEvent(
      db,
      {
        workspaceId,
        projectId: card.projectId ?? undefined,
        featureId: card.featureId ?? undefined,
        entityType: "ai_pm_action_card",
        entityId: actionId,
        eventType: "ai_pm.action_applied",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          actionId,
          actionType: card.actionType,
          result: result.kind,
        },
      },
      () => [
        {
          sql: `UPDATE ai_pm_action_cards
            SET status = ?, applied_at = ?, applied_by = ?
            WHERE id = ? AND workspace_id = ? AND status = 'pending'`,
          params: ["applied", ...params.slice(0, 2), ...params.slice(3)],
        },
      ],
    );

    const refreshed = await actionCardService.get(db, workspaceId, actionId);
    if (!refreshed) throw new Error("action card vanished after apply");
    return { card: refreshed, result };
  },

  async dismiss(db, actor, workspaceId, actionId, reason) {
    const card = await actionCardService.get(db, workspaceId, actionId);
    if (!card) throw new NotFoundError("ai_pm_action_card", actionId);
    if (card.status !== "pending") {
      throw new ConflictError(`action card ${actionId} is already ${card.status}`);
    }
    if (isHighRiskActionType(card.actionType) && !reason?.trim()) {
      throw new ValidationError(
        "dismiss_reason required for high-risk action dismissal",
        { actionId, actionType: card.actionType },
      );
    }

    await withEvent(
      db,
      {
        workspaceId,
        projectId: card.projectId ?? undefined,
        featureId: card.featureId ?? undefined,
        entityType: "ai_pm_action_card",
        entityId: actionId,
        eventType: "ai_pm.action_dismissed",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          actionId,
          actionType: card.actionType,
          reason: reason ?? null,
        },
      },
      () => [
        {
          sql: `UPDATE ai_pm_action_cards
            SET status = 'dismissed', dismissed_at = ?, dismissed_by = ?, dismiss_reason = ?
            WHERE id = ? AND workspace_id = ? AND status = 'pending'`,
          params: [
            Date.now(),
            actor.id ?? null,
            reason ?? null,
            actionId,
            workspaceId,
          ] as SqlBindValue[],
        },
      ],
    );

    const refreshed = await actionCardService.get(db, workspaceId, actionId);
    if (!refreshed) throw new Error("action card vanished after dismiss");
    return refreshed;
  },

  async edit(db, actor, workspaceId, actionId, editedPayload) {
    const card = await actionCardService.get(db, workspaceId, actionId);
    if (!card) throw new NotFoundError("ai_pm_action_card", actionId);
    if (card.status !== "pending") {
      throw new ConflictError(`action card ${actionId} is already ${card.status}; cannot edit`);
    }
    // Validate the edited payload against the stored action type's schema.
    const validated = validateActionPayload(card.actionType as ActionType, editedPayload);

    await withEvent(
      db,
      {
        workspaceId,
        projectId: card.projectId ?? undefined,
        featureId: card.featureId ?? undefined,
        entityType: "ai_pm_action_card",
        entityId: actionId,
        eventType: "ai_pm.action_edited",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          actionId,
          actionType: card.actionType,
          editCount: card.editCount + 1,
        },
      },
      () => [
        {
          sql: `UPDATE ai_pm_action_cards
            SET payload_json = ?, edit_count = edit_count + 1
            WHERE id = ? AND workspace_id = ? AND status = 'pending'`,
          params: [
            JSON.stringify(validated),
            actionId,
            workspaceId,
          ] as SqlBindValue[],
        },
      ],
    );

    const refreshed = await actionCardService.get(db, workspaceId, actionId);
    if (!refreshed) throw new Error("action card vanished after edit");
    return refreshed;
  },
};

// ---------------------------------------------------------------------------
// Per-action-type write executor. Each branch delegates to the appropriate
// domain service so the event log + idempotency invariants are preserved.
// ---------------------------------------------------------------------------

async function executeActionWrite(
  db: DbClient,
  actor: ActorContext,
  workspaceId: string,
  actionType: ActionType,
  payload: unknown,
  target: { project_id?: string; feature_id?: string },
): Promise<ApplyResult> {
  switch (actionType) {
    case "create_feature": {
      const p = payload as CreateFeaturePayload;
      const projectId = target.project_id;
      if (!projectId) throw new ValidationError("project_id required for create_feature");
      const feature = await featureService.create(db, actor, workspaceId, projectId, {
        name: p.name,
        description: p.description,
      });
      return { kind: "create_feature", featureId: feature.id };
    }

    case "create_work_item": {
      const p = payload as CreateWorkItemPayload;
      const projectId = target.project_id;
      if (!projectId) throw new ValidationError("project_id required for create_work_item");
      // Resolve state_id from state_name (if provided).
      let stateId: string | undefined;
      if (p.state_name) {
        const states = await import("./state").then((m) => m.stateService.list(db, workspaceId, projectId));
        const found = states.find((s) => s.name === p.state_name);
        if (!found) {
          throw new ValidationError(`state "${p.state_name}" not found in project`);
        }
        stateId = found.id;
      }
      const wi = await workItemService.create(db, actor, workspaceId, projectId, {
        title: p.title,
        type: p.type,
        priority: p.priority,
        stateId,
        featureId: target.feature_id,
      });
      return { kind: "create_work_item", workItemId: wi.id };
    }

    case "update_work_item_priority": {
      const p = payload as UpdateWorkItemPriorityPayload;
      await workItemService.update(db, actor, workspaceId, p.work_item_id, {
        priority: p.priority,
      });
      return { kind: "update_work_item_priority", workItemId: p.work_item_id };
    }

    case "set_current_focus": {
      const p = payload as SetCurrentFocusPayload;
      // Record the focus as a decision (v1 has no dedicated current_focus table).
      const focusText = p.feature_id
        ? `Focus on feature ${p.feature_id}${p.note ? `: ${p.note}` : ""}`
        : `Focus on work item ${p.work_item_id}${p.note ? `: ${p.note}` : ""}`;
      const decision = await decisionService.record(db, actor, workspaceId, {
        projectId: target.project_id,
        featureId: p.feature_id ?? target.feature_id,
        decisionText: focusText,
        rationale: p.note,
        source: "ai_pm",
      });
      return { kind: "set_current_focus", decisionId: decision.id };
    }

    case "record_decision": {
      const p = payload as RecordDecisionPayload;
      const decision = await decisionService.record(db, actor, workspaceId, {
        projectId: target.project_id,
        featureId: target.feature_id,
        decisionText: p.decision_text,
        rationale: p.rationale,
        source: "ai_pm",
      });
      return { kind: "record_decision", decisionId: decision.id };
    }

    case "create_review_fix_items": {
      const p = payload as CreateReviewFixItemsPayload;
      const result = await reviewService.createFollowupFixes(db, actor, workspaceId, {
        reviewId: p.review_id,
      });
      return { kind: "create_review_fix_items", createdCount: result.createdFixes.length };
    }

    case "save_weekly_review": {
      const p = payload as SaveWeeklyReviewPayload;
      const review = await weeklyReviewService.save(db, actor, workspaceId, {
        projectId: p.project_id,
        weekStart: p.week_start,
        weekEnd: p.week_end,
        summaryJson: p.summary_json,
      });
      return { kind: "save_weekly_review", weeklyReviewId: review.id };
    }

    case "generate_agent_prompt": {
      const p = payload as GenerateAgentPromptPayload;
      const prompt = buildAgentPrompt(p, target);
      return { kind: "generate_agent_prompt", prompt };
    }

    case "pause_project": {
      const p = payload as PauseProjectPayload;
      await projectService.update(db, actor, workspaceId, p.project_id, {
        status: "paused",
      });
      return { kind: "pause_project", projectId: p.project_id };
    }

    case "archive_project": {
      const p = payload as ArchiveProjectPayload;
      await projectService.update(db, actor, workspaceId, p.project_id, {
        status: "archived",
      });
      return { kind: "archive_project", projectId: p.project_id };
    }

    case "dismiss_high_finding": {
      const p = payload as DismissHighFindingPayload;
      await reviewService.dismissFinding(db, actor, workspaceId, p.finding_id, p.reason);
      return { kind: "dismiss_high_finding", findingId: p.finding_id };
    }

    case "mark_feature_done": {
      const p = payload as MarkFeatureDonePayload;
      const featureId = p.feature_id ?? target.feature_id;
      if (!featureId) throw new ValidationError("feature_id required for mark_feature_done");
      await featureService.changeStatus(db, actor, workspaceId, featureId, "done");
      return { kind: "mark_feature_done", featureId };
    }

    case "change_portfolio_priority": {
      const p = payload as ChangePortfolioPriorityPayload;
      await projectService.update(db, actor, workspaceId, p.project_id, {
        portfolioPriority: p.priority,
      });
      return { kind: "change_portfolio_priority", projectId: p.project_id };
    }
  }
}

/**
 * Build a coding-agent prompt from a generate_agent_prompt action payload.
 * Not a domain write — produces a string the UI can copy. The action's
 * apply result carries the prompt text so the UI can display it inline.
 */
function buildAgentPrompt(
  p: GenerateAgentPromptPayload,
  target: { project_id?: string; feature_id?: string },
): string {
  const lines: string[] = [];
  lines.push(`# StateHub ${p.agent} ${p.prompt_kind} prompt`);
  lines.push("");
  if (p.feature_id ?? target.feature_id) {
    lines.push(`Feature: ${p.feature_id ?? target.feature_id}`);
  }
  if (p.notes) {
    lines.push(`Notes: ${p.notes}`);
  }
  lines.push("");
  lines.push("## Sync instructions");
  lines.push(
    `Use the StateHub ${p.agent === "opencode" ? "OpenCode" : "Codex"} MCP integration to:`,
  );
  lines.push("1. Call get_current_focus to read the current focus.");
  lines.push("2. Call start_agent_run with run_type=" + p.prompt_kind);
  lines.push("3. Do the work; sync work items + todos via upsert_work_items / upsert_todos.");
  lines.push("4. Call record_test_command for each test command run.");
  lines.push("5. Call sync_evidence with the test result + git context.");
  lines.push("6. Call complete_agent_run_local with the summary.");
  lines.push("");
  lines.push("## Done Gate");
  lines.push(
    "Feature is 'done' only when the Done Gate v1 passes. Do not mark done without:",
  );
  lines.push("- At least one trusted evidence row");
  lines.push("- No open blocker/high findings");
  lines.push("- All open todos closed");
  return lines.join("\n");
}
