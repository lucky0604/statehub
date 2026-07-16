/**
 * AI PM answer envelope schema.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md §1, §5
 *
 * Every AI PM response (from any mode) is parsed into this shape. The
 * parser is strict: extra fields are rejected. The `suggested_actions`
 * array is validated against the action card envelope schema, so a
 * malformed action payload never reaches the DB.
 *
 * The `basis` array is the safety spine: every claim the AI PM makes must
 * cite a StateHub entity by name/id. The UI renders basis as a list of
 * "Because <entity> <fact>" bullets so the user can audit the reasoning.
 */
import { z } from "zod";
import { actionCardEnvelopeSchema } from "./action-schema";

export const AIPM_MODES = [
  "advisor",
  "plan",
  "review_triage",
  "weekly_review",
  "prompt_builder",
] as const;

export type AIPmMode = (typeof AIPM_MODES)[number];

export const basisEntrySchema = z
  .object({
    entity: z.string().min(1).max(200), // e.g. "feature:feat-abc" or "work_item:STH-14"
    fact: z.string().min(1).max(500),
  })
  .strict();

export type BasisEntry = z.infer<typeof basisEntrySchema>;

export const answerEnvelopeSchema = z
  .object({
    mode: z.enum(AIPM_MODES),
    conclusion: z.string().min(1).max(2000),
    basis: z.array(basisEntrySchema).max(20),
    risks: z.array(z.string().max(500)).max(10),
    missing_data: z.array(z.string().max(500)).max(10),
    suggested_actions: z.array(actionCardEnvelopeSchema).max(10),
  })
  .strict();

export type AnswerEnvelope = z.infer<typeof answerEnvelopeSchema>;

/**
 * Parse an AI provider's raw text response into an AnswerEnvelope.
 *
 * The provider is expected to return JSON matching the schema. If the
 * JSON is malformed or fails schema validation, this throws a
 * `AIOutputParseError` with the underlying zod error.
 */
export class AIOutputParseError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AIOutputParseError";
    this.cause = cause;
  }
}

export function parseAIAnswer(raw: string): AnswerEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new AIOutputParseError("AI response was not valid JSON", e);
  }
  const result = answerEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    throw new AIOutputParseError(
      `AI response failed schema validation: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      result.error,
    );
  }
  return result.data;
}
