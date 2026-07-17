/**
 * Action card schema — every AI PM proposed action is validated against one
 * of these zod schemas before it is persisted, and again before it is
 * applied.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md §5
 *
 * The schema is a discriminated union on `type`. Each variant carries a
 * payload shape tailored to the underlying domain write. High-risk action
 * types (§5 list) carry `requires_confirmation: true` and the apply path
 * demands an explicit confirmation flag from the client.
 *
 * Server-side action validators (packages/domain/src/services/action-validators.ts)
 * re-check the payload against current DB state — e.g. create_work_item
 * validates that project_id + state_id exist in the workspace. The zod
 * schema here only checks the payload's shape; the validator checks its
 * referential integrity.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Action types — split into normal (auto-appliable on click) and high-risk
// (require an explicit confirmation modal).
// ---------------------------------------------------------------------------

export const NORMAL_ACTION_TYPES = [
  "create_feature",
  "create_work_item",
  "update_work_item_priority",
  "set_current_focus",
  "record_decision",
  "create_review_fix_items",
  "save_weekly_review",
  "generate_agent_prompt",
] as const;

export const HIGH_RISK_ACTION_TYPES = [
  "pause_project",
  "archive_project",
  "dismiss_high_finding",
  "mark_feature_done",
  "change_portfolio_priority",
] as const;

export const ACTION_TYPES = [...NORMAL_ACTION_TYPES, ...HIGH_RISK_ACTION_TYPES] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
export type NormalActionType = (typeof NORMAL_ACTION_TYPES)[number];
export type HighRiskActionType = (typeof HIGH_RISK_ACTION_TYPES)[number];

export function isHighRiskActionType(type: string): boolean {
  return (HIGH_RISK_ACTION_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Target — the entity scope the action applies to.
// ---------------------------------------------------------------------------

export const actionTargetSchema = z
  .object({
    project_id: z.string().optional(),
    feature_id: z.string().optional(),
    work_item_id: z.string().optional(),
  })
  .strict();

export type ActionTarget = z.infer<typeof actionTargetSchema>;

// ---------------------------------------------------------------------------
// Per-type payload schemas.
// ---------------------------------------------------------------------------

export const createFeaturePayloadSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
  })
  .strict();

export const createWorkItemPayloadSchema = z
  .object({
    title: z.string().min(1).max(300),
    type: z.enum(["issue", "task", "bug", "enhancement", "note"]),
    priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
    state_name: z.string().optional(), // resolved to state_id by the validator
    description: z.string().max(5000).optional(),
  })
  .strict();

export const updateWorkItemPriorityPayloadSchema = z
  .object({
    work_item_id: z.string(),
    priority: z.enum(["urgent", "high", "medium", "low", "none"]),
  })
  .strict();

export const setCurrentFocusPayloadSchema = z
  .object({
    feature_id: z.string().optional(),
    work_item_id: z.string().optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => v.feature_id !== undefined || v.work_item_id !== undefined, {
    message: "set_current_focus payload must include feature_id or work_item_id",
  });

export const recordDecisionPayloadSchema = z
  .object({
    decision_text: z.string().min(1).max(1000),
    rationale: z.string().max(2000).optional(),
  })
  .strict();

export const createReviewFixItemsPayloadSchema = z
  .object({
    review_id: z.string(),
  })
  .strict();

export const saveWeeklyReviewPayloadSchema = z
  .object({
    project_id: z.string().optional(),
    week_start: z.number().int(),
    week_end: z.number().int(),
    summary_json: z.string(),
  })
  .strict();

export const generateAgentPromptPayloadSchema = z
  .object({
    agent: z.enum(["opencode", "codex"]),
    feature_id: z.string().optional(),
    prompt_kind: z.enum(["implement", "review", "fix", "release"]),
    notes: z.string().max(2000).optional(),
  })
  .strict();

// High-risk payloads

export const pauseProjectPayloadSchema = z
  .object({
    project_id: z.string(),
    rationale: z.string().min(1).max(2000),
  })
  .strict();

export const archiveProjectPayloadSchema = z
  .object({
    project_id: z.string(),
    rationale: z.string().min(1).max(2000),
  })
  .strict();

export const dismissHighFindingPayloadSchema = z
  .object({
    finding_id: z.string(),
    reason: z.string().min(1).max(2000),
  })
  .strict();

export const markFeatureDonePayloadSchema = z
  .object({
    feature_id: z.string(),
  })
  .strict();

export const changePortfolioPriorityPayloadSchema = z
  .object({
    project_id: z.string(),
    priority: z.enum(["P0", "P1", "P2", "Parked"]),
  })
  .strict();

// ---------------------------------------------------------------------------
// Discriminated union of action card envelopes.
// ---------------------------------------------------------------------------

export const actionCardEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_feature"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: createFeaturePayloadSchema,
    reason: z.string().max(1000),
    risk: z.string().max(1000).optional(),
    requires_confirmation: z.literal(false),
  }),
  z.object({
    type: z.literal("create_work_item"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: createWorkItemPayloadSchema,
    reason: z.string().max(1000),
    risk: z.string().max(1000).optional(),
    requires_confirmation: z.literal(false),
  }),
  z.object({
    type: z.literal("update_work_item_priority"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: updateWorkItemPriorityPayloadSchema,
    reason: z.string().max(1000),
    risk: z.string().max(1000).optional(),
    requires_confirmation: z.literal(false),
  }),
  z.object({
    type: z.literal("set_current_focus"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: setCurrentFocusPayloadSchema,
    reason: z.string().max(1000),
    risk: z.string().max(1000).optional(),
    requires_confirmation: z.literal(false),
  }),
  z.object({
    type: z.literal("record_decision"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: recordDecisionPayloadSchema,
    reason: z.string().max(1000),
    risk: z.string().max(1000).optional(),
    requires_confirmation: z.literal(false),
  }),
  z.object({
    type: z.literal("create_review_fix_items"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: createReviewFixItemsPayloadSchema,
    reason: z.string().max(1000),
    risk: z.string().max(1000).optional(),
    requires_confirmation: z.literal(false),
  }),
  z.object({
    type: z.literal("save_weekly_review"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: saveWeeklyReviewPayloadSchema,
    reason: z.string().max(1000),
    risk: z.string().max(1000).optional(),
    requires_confirmation: z.literal(false),
  }),
  z.object({
    type: z.literal("generate_agent_prompt"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: generateAgentPromptPayloadSchema,
    reason: z.string().max(1000),
    risk: z.string().max(1000).optional(),
    requires_confirmation: z.literal(false),
  }),
  // High-risk variants — requires_confirmation: true
  z.object({
    type: z.literal("pause_project"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: pauseProjectPayloadSchema,
    reason: z.string().min(1).max(1000),
    risk: z.string().min(1).max(1000),
    requires_confirmation: z.literal(true),
  }),
  z.object({
    type: z.literal("archive_project"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: archiveProjectPayloadSchema,
    reason: z.string().min(1).max(1000),
    risk: z.string().min(1).max(1000),
    requires_confirmation: z.literal(true),
  }),
  z.object({
    type: z.literal("dismiss_high_finding"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: dismissHighFindingPayloadSchema,
    reason: z.string().min(1).max(1000),
    risk: z.string().min(1).max(1000),
    requires_confirmation: z.literal(true),
  }),
  z.object({
    type: z.literal("mark_feature_done"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: markFeatureDonePayloadSchema,
    reason: z.string().min(1).max(1000),
    risk: z.string().min(1).max(1000),
    requires_confirmation: z.literal(true),
  }),
  z.object({
    type: z.literal("change_portfolio_priority"),
    title: z.string().min(1).max(200),
    target: actionTargetSchema,
    payload: changePortfolioPriorityPayloadSchema,
    reason: z.string().min(1).max(1000),
    risk: z.string().min(1).max(1000),
    requires_confirmation: z.literal(true),
  }),
]);

export type ActionCardEnvelope = z.infer<typeof actionCardEnvelopeSchema>;

// Per-type payload type helpers (consumers can import these directly).
export type CreateFeaturePayload = z.infer<typeof createFeaturePayloadSchema>;
export type CreateWorkItemPayload = z.infer<typeof createWorkItemPayloadSchema>;
export type UpdateWorkItemPriorityPayload = z.infer<
  typeof updateWorkItemPriorityPayloadSchema
>;
export type SetCurrentFocusPayload = z.infer<typeof setCurrentFocusPayloadSchema>;
export type RecordDecisionPayload = z.infer<typeof recordDecisionPayloadSchema>;
export type CreateReviewFixItemsPayload = z.infer<
  typeof createReviewFixItemsPayloadSchema
>;
export type SaveWeeklyReviewPayload = z.infer<typeof saveWeeklyReviewPayloadSchema>;
export type GenerateAgentPromptPayload = z.infer<
  typeof generateAgentPromptPayloadSchema
>;
export type PauseProjectPayload = z.infer<typeof pauseProjectPayloadSchema>;
export type ArchiveProjectPayload = z.infer<typeof archiveProjectPayloadSchema>;
export type DismissHighFindingPayload = z.infer<typeof dismissHighFindingPayloadSchema>;
export type MarkFeatureDonePayload = z.infer<typeof markFeatureDonePayloadSchema>;
export type ChangePortfolioPriorityPayload = z.infer<
  typeof changePortfolioPriorityPayloadSchema
>;

/**
 * Map of action type → payload schema. Used by the server-side validators
 * to re-validate a stored payload before applying it.
 */
export const PAYLOAD_SCHEMAS_BY_TYPE = {
  create_feature: createFeaturePayloadSchema,
  create_work_item: createWorkItemPayloadSchema,
  update_work_item_priority: updateWorkItemPriorityPayloadSchema,
  set_current_focus: setCurrentFocusPayloadSchema,
  record_decision: recordDecisionPayloadSchema,
  create_review_fix_items: createReviewFixItemsPayloadSchema,
  save_weekly_review: saveWeeklyReviewPayloadSchema,
  generate_agent_prompt: generateAgentPromptPayloadSchema,
  pause_project: pauseProjectPayloadSchema,
  archive_project: archiveProjectPayloadSchema,
  dismiss_high_finding: dismissHighFindingPayloadSchema,
  mark_feature_done: markFeatureDonePayloadSchema,
  change_portfolio_priority: changePortfolioPriorityPayloadSchema,
} as const;

/**
 * Validate an action card envelope. Throws a zod ZodError on failure —
 * callers should catch and convert to a ValidationError.
 */
export function validateActionCardEnvelope(input: unknown): ActionCardEnvelope {
  return actionCardEnvelopeSchema.parse(input);
}

/**
 * Validate just the payload for a given action type. Used by the apply
 * path to re-check edited payloads.
 */
export function validateActionPayload(type: ActionType, payload: unknown): unknown {
  const schema = PAYLOAD_SCHEMAS_BY_TYPE[type];
  if (!schema) {
    throw new Error(`Unknown action type: ${type}`);
  }
  return schema.parse(payload);
}
