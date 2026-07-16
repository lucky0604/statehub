/**
 * Canonical error codes for StateHub API + MCP responses.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §14
 *
 * Every API route handler and MCP tool response MUST use one of these codes.
 * Adding a new code requires updating this const + the data contracts doc.
 */
export const ERROR_CODES = [
  "validation_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "repo_conflict",
  "idempotency_conflict",
  "rate_limited",
  "workspace_mismatch",
  "scope_missing",
  "transition_not_allowed",
  "external_source_error",
  "internal_error",
  // P05A: AI PM action-card safety. Used when the user tries to apply a
  // mark_feature_done action but the Done Gate is currently blocking the
  // feature. Distinct from `transition_not_allowed` (state-machine) and
  // `validation_error` (schema) so the UI can surface the gate checklist.
  "done_gate_blocked",
  // P05A: AI PM high-risk confirmation. Returned when a high-risk action
  // (pause/archive/dismiss_high/mark_done/change_priority) is applied
  // without confirm_high_risk=true. Retryable once the user confirms.
  "high_risk_confirmation_required",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Codes where retrying the same request is safe and likely to succeed.
 * Used to populate the `retryable` field on error envelopes.
 */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  "rate_limited",
  "external_source_error",
  "internal_error",
]);

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}
