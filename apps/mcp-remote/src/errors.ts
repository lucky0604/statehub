/**
 * Convert a thrown DomainError (or generic Error) into an MCP tool error result
 * matching the phase-02 §4.3 envelope: { ok:false, error_code, message, retryable, next_action? }.
 *
 * Mirrors apps/web/src/lib/api-handler.ts errorStatus mapping, but tools return
 * the envelope inside the MCP response rather than an HTTP status.
 */
import { DomainError } from "@statehub/domain";
import type { ApiResult } from "@statehub/shared";
import { isRetryable } from "@statehub/shared";

export function toToolError(e: unknown): ApiResult<never> {
  if (e instanceof DomainError) {
    return {
      ok: false,
      error_code: e.code,
      message: e.message,
      retryable: isRetryable(e.code),
      ...(e.extra?.next_action ? { next_action: String(e.extra.next_action) } : {}),
    };
  }
  const msg = e instanceof Error ? e.message : "internal error";
  console.error("[mcp] unhandled tool error:", e);
  return { ok: false, error_code: "internal_error", message: msg, retryable: false };
}
