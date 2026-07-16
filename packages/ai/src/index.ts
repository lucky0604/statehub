/**
 * @statehub/ai — AI PM provider abstraction, context builder, action schema,
 * and prompt templates for the writable AI PM (Phase 05).
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md
 *
 * Public surface:
 *   - action-schema.ts — zod schemas for all 13 action card types
 *   - answer-schema.ts — answer envelope schema + parser
 *   - context-builder.ts — ContextPacket builder
 *   - prompts.ts — system prompt + mode templates
 *   - provider.ts — AIProvider interface + Deterministic + OpenAI-compatible
 *
 * Domain services live in @statehub/domain (aiPmService, actionCardService,
 * decisionService, weeklyReviewService) — they consume this package.
 */
export {
  ACTION_TYPES,
  NORMAL_ACTION_TYPES,
  HIGH_RISK_ACTION_TYPES,
  isHighRiskActionType,
  actionTargetSchema,
  actionCardEnvelopeSchema,
  PAYLOAD_SCHEMAS_BY_TYPE,
  validateActionCardEnvelope,
  validateActionPayload,
  type ActionType,
  type NormalActionType,
  type HighRiskActionType,
  type ActionTarget,
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
} from "./action-schema";

export {
  AIPM_MODES,
  answerEnvelopeSchema,
  basisEntrySchema,
  parseAIAnswer,
  AIOutputParseError,
  type AIPmMode,
  type AnswerEnvelope,
  type BasisEntry,
} from "./answer-schema";

export {
  buildContextPacket,
  type ContextPacket,
  type BuildContextInput,
} from "./context-builder";

export {
  SYSTEM_PROMPT,
  MODE_PROMPTS,
  buildUserPrompt,
} from "./prompts";

export {
  DeterministicProvider,
  OpenAICompatibleProvider,
  pickProvider,
  type AIProvider,
  type AICompleteRequest,
  type AICompleteResponse,
  type ProviderEnv,
  type OpenAICompatibleConfig,
} from "./provider";
