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
  "idempotency_conflict",
  "rate_limited",
  "workspace_mismatch",
  "scope_missing",
  "transition_not_allowed",
  "external_source_error",
  "internal_error",
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
