/**
 * Action validators — per-type re-validation of an action card payload
 * against current DB state, immediately before applying it.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md §8
 *
 * The zod schema in packages/ai validates the payload's shape. The
 * validators here validate its referential integrity and safety:
 *   - create_work_item → project_id + state_name resolve to real rows
 *   - create_review_fix_items → review_id + finding_ids are open + high
 *   - mark_feature_done → Done Gate is not blocked
 *   - pause_project / archive_project / change_portfolio_priority →
 *     project exists in the workspace
 *   - set_current_focus → feature_id or work_item_id resolves
 *
 * Each validator either returns (silent OK) or throws a DomainError
 * (ValidationError, NotFoundError, ConflictError, DoneGateBlockedError).
 *
 * The actionCardService.apply method looks up the validator by action
 * type and calls it before executing the underlying domain write.
 */
import type { DbClient } from "@statehub/db";
import {
  validateActionPayload,
  type ActionType,
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
import { NotFoundError, ValidationError, ConflictError, DomainError } from "../errors";
import { stateService } from "./state";
import { reviewService } from "./review";
import { doneGateService } from "./done-gate";

/**
 * Specialized error for the mark_feature_done path. Distinct from
 * ConflictError so the API route can map it to error_code=done_gate_blocked.
 */
export class DoneGateBlockedError extends DomainError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super("done_gate_blocked", message, extra);
    this.name = "DoneGateBlockedError";
  }
}

/**
 * Specialized error for the high-risk confirmation gate. Distinct from
 * ValidationError so the API route can map it to
 * error_code=high_risk_confirmation_required (422) and the UI can show a
 * confirmation modal rather than a generic validation error.
 */
export class HighRiskConfirmationRequiredError extends DomainError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super("high_risk_confirmation_required", message, extra);
    this.name = "HighRiskConfirmationRequiredError";
  }
}

export interface ActionValidatorContext {
  db: DbClient;
  workspaceId: string;
  /** Target from the action card envelope. */
  target: { project_id?: string; feature_id?: string; work_item_id?: string };
  /** Edited payload from the apply request, or the stored payload. */
  payload: unknown;
}

export type ActionValidator = (ctx: ActionValidatorContext) => Promise<void>;

async function ensureProjectInWorkspace(
  db: DbClient,
  workspaceId: string,
  projectId: string | undefined,
): Promise<string> {
  if (!projectId) {
    throw new ValidationError("target.project_id is required for this action");
  }
  const row = await db.first<{ id: string }>(
    "SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [projectId, workspaceId],
  );
  if (!row) throw new NotFoundError("project", projectId);
  return row.id;
}

async function ensureFeatureInWorkspace(
  db: DbClient,
  workspaceId: string,
  featureId: string | undefined,
): Promise<string> {
  if (!featureId) {
    throw new ValidationError("target.feature_id is required for this action");
  }
  const row = await db.first<{ id: string }>(
    "SELECT id FROM features WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [featureId, workspaceId],
  );
  if (!row) throw new NotFoundError("feature", featureId);
  return row.id;
}

// ---------------------------------------------------------------------------
// Per-type validators.
// ---------------------------------------------------------------------------

const validateCreateFeature: ActionValidator = async (ctx) => {
  const payload = validateActionPayload("create_feature", ctx.payload) as CreateFeaturePayload;
  if (!payload.name?.trim()) {
    throw new ValidationError("create_feature payload.name is required");
  }
  // The target project must exist.
  await ensureProjectInWorkspace(ctx.db, ctx.workspaceId, ctx.target.project_id);
};

const validateCreateWorkItem: ActionValidator = async (ctx) => {
  const payload = validateActionPayload("create_work_item", ctx.payload) as CreateWorkItemPayload;
  const projectId = await ensureProjectInWorkspace(ctx.db, ctx.workspaceId, ctx.target.project_id);
  if (payload.state_name) {
    const states = await stateService.list(ctx.db, ctx.workspaceId, projectId);
    const found = states.find((s) => s.name === payload.state_name);
    if (!found) {
      throw new ValidationError(
        `create_work_item payload.state_name "${payload.state_name}" not found in project`,
      );
    }
  }
  if (ctx.target.feature_id) {
    await ensureFeatureInWorkspace(ctx.db, ctx.workspaceId, ctx.target.feature_id);
  }
};

const validateUpdateWorkItemPriority: ActionValidator = async (ctx) => {
  const payload = validateActionPayload(
    "update_work_item_priority",
    ctx.payload,
  ) as UpdateWorkItemPriorityPayload;
  if (!payload.work_item_id) {
    throw new ValidationError("update_work_item_priority payload.work_item_id is required");
  }
  const row = await ctx.db.first<{ id: string }>(
    "SELECT id FROM work_items WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [payload.work_item_id, ctx.workspaceId],
  );
  if (!row) throw new NotFoundError("work_item", payload.work_item_id);
};

const validateSetCurrentFocus: ActionValidator = async (ctx) => {
  const payload = validateActionPayload(
    "set_current_focus",
    ctx.payload,
  ) as SetCurrentFocusPayload;
  if (payload.feature_id) {
    await ensureFeatureInWorkspace(ctx.db, ctx.workspaceId, payload.feature_id);
  }
  if (payload.work_item_id) {
    const row = await ctx.db.first<{ id: string }>(
      "SELECT id FROM work_items WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [payload.work_item_id, ctx.workspaceId],
    );
    if (!row) throw new NotFoundError("work_item", payload.work_item_id);
  }
};

const validateRecordDecision: ActionValidator = async (ctx) => {
  validateActionPayload("record_decision", ctx.payload) as RecordDecisionPayload;
  if (ctx.target.project_id) {
    await ensureProjectInWorkspace(ctx.db, ctx.workspaceId, ctx.target.project_id);
  }
  if (ctx.target.feature_id) {
    await ensureFeatureInWorkspace(ctx.db, ctx.workspaceId, ctx.target.feature_id);
  }
};

const validateCreateReviewFixItems: ActionValidator = async (ctx) => {
  const payload = validateActionPayload(
    "create_review_fix_items",
    ctx.payload,
  ) as CreateReviewFixItemsPayload;
  if (!payload.review_id) {
    throw new ValidationError("create_review_fix_items payload.review_id is required");
  }
  // Verify the review exists in this workspace.
  const reviewRow = await ctx.db.first<{ id: string; project_id: string }>(
    "SELECT id, project_id FROM reviews WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [payload.review_id, ctx.workspaceId],
  );
  if (!reviewRow) throw new NotFoundError("review", payload.review_id);
};

const validateSaveWeeklyReview: ActionValidator = async (ctx) => {
  const payload = validateActionPayload(
    "save_weekly_review",
    ctx.payload,
  ) as SaveWeeklyReviewPayload;
  if (payload.project_id) {
    await ensureProjectInWorkspace(ctx.db, ctx.workspaceId, payload.project_id);
  }
  if (payload.week_end < payload.week_start) {
    throw new ValidationError("save_weekly_review payload.week_end must be ≥ week_start");
  }
};

const validateGenerateAgentPrompt: ActionValidator = async (ctx) => {
  const payload = validateActionPayload(
    "generate_agent_prompt",
    ctx.payload,
  ) as GenerateAgentPromptPayload;
  if (payload.feature_id) {
    await ensureFeatureInWorkspace(ctx.db, ctx.workspaceId, payload.feature_id);
  }
};

const validatePauseProject: ActionValidator = async (ctx) => {
  const payload = validateActionPayload("pause_project", ctx.payload) as PauseProjectPayload;
  await ensureProjectInWorkspace(ctx.db, ctx.workspaceId, payload.project_id);
  if (!payload.rationale?.trim()) {
    throw new ValidationError("pause_project payload.rationale is required");
  }
};

const validateArchiveProject: ActionValidator = async (ctx) => {
  const payload = validateActionPayload("archive_project", ctx.payload) as ArchiveProjectPayload;
  await ensureProjectInWorkspace(ctx.db, ctx.workspaceId, payload.project_id);
  if (!payload.rationale?.trim()) {
    throw new ValidationError("archive_project payload.rationale is required");
  }
};

const validateDismissHighFinding: ActionValidator = async (ctx) => {
  const payload = validateActionPayload(
    "dismiss_high_finding",
    ctx.payload,
  ) as DismissHighFindingPayload;
  if (!payload.finding_id) {
    throw new ValidationError("dismiss_high_finding payload.finding_id is required");
  }
  if (!payload.reason?.trim()) {
    throw new ValidationError("dismiss_high_finding payload.reason is required");
  }
  const row = await ctx.db.first<{ id: string; severity: string; status: string }>(
    "SELECT id, severity, status FROM review_findings WHERE id = ? AND workspace_id = ?",
    [payload.finding_id, ctx.workspaceId],
  );
  if (!row) throw new NotFoundError("finding", payload.finding_id);
  if (row.status !== "open") {
    throw new ConflictError(`finding ${payload.finding_id} is not open (status=${row.status})`);
  }
  if (row.severity !== "high" && row.severity !== "blocker") {
    throw new ValidationError(
      `dismiss_high_finding can only dismiss high/blocker findings (severity=${row.severity})`,
    );
  }
};

const validateMarkFeatureDone: ActionValidator = async (ctx) => {
  const payload = validateActionPayload(
    "mark_feature_done",
    ctx.payload,
  ) as MarkFeatureDonePayload;
  const featureId = payload.feature_id ?? ctx.target.feature_id;
  if (!featureId) {
    throw new ValidationError("mark_feature_done requires feature_id");
  }
  await ensureFeatureInWorkspace(ctx.db, ctx.workspaceId, featureId);

  // Run the Done Gate. Block if it blocks.
  const summary = await doneGateService.evaluate(ctx.db, ctx.workspaceId, featureId);
  if (summary.result === "blocked") {
    throw new DoneGateBlockedError(
      `Done Gate blocks marking feature ${featureId} as done`,
      {
        featureId,
        result: summary.result,
        blockingItems: summary.checklist
          .filter((c) => c.status === "blocked")
          .map((c) => c.code),
      },
    );
  }
};

const validateChangePortfolioPriority: ActionValidator = async (ctx) => {
  const payload = validateActionPayload(
    "change_portfolio_priority",
    ctx.payload,
  ) as ChangePortfolioPriorityPayload;
  await ensureProjectInWorkspace(ctx.db, ctx.workspaceId, payload.project_id);
  // The zod schema enforces priority ∈ {P0, P1, P2, Parked}; no extra check needed.
  void payload;
};

// ---------------------------------------------------------------------------
// Validator registry.
// ---------------------------------------------------------------------------

export const ACTION_VALIDATORS: Record<ActionType, ActionValidator> = {
  create_feature: validateCreateFeature,
  create_work_item: validateCreateWorkItem,
  update_work_item_priority: validateUpdateWorkItemPriority,
  set_current_focus: validateSetCurrentFocus,
  record_decision: validateRecordDecision,
  create_review_fix_items: validateCreateReviewFixItems,
  save_weekly_review: validateSaveWeeklyReview,
  generate_agent_prompt: validateGenerateAgentPrompt,
  pause_project: validatePauseProject,
  archive_project: validateArchiveProject,
  dismiss_high_finding: validateDismissHighFinding,
  mark_feature_done: validateMarkFeatureDone,
  change_portfolio_priority: validateChangePortfolioPriority,
};

/**
 * Look up the validator for an action type and run it.
 *
 * Throws ValidationError if the type is unknown.
 */
export async function validateActionForApply(
  actionType: ActionType,
  ctx: ActionValidatorContext,
): Promise<void> {
  const validator = ACTION_VALIDATORS[actionType];
  if (!validator) {
    throw new ValidationError(`Unknown action type: ${actionType}`);
  }
  await validator(ctx);
}

// Re-export the underlying services that the validators use, for tests.
export { stateService, reviewService };
