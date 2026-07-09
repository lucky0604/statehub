import type { ErrorCode } from "./error-codes";
import { isRetryable } from "./error-codes";

/**
 * Canonical StateHub API envelope.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §3.4
 *         agent_flow/implementation/v1/phases/phase-00-foundation.md §3.4
 *
 * Success: { ok: true, data, meta? }
 * Error:   { ok: false, error_code, message, retryable, next_action? }
 *
 * Every API route handler and MCP tool response returns this shape.
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  ok: false;
  error_code: ErrorCode;
  message: string;
  retryable: boolean;
  next_action?: string;
  /** Optional field-level details for validation_error. */
  fields?: Record<string, string>;
}

export type ApiResult<T> = ApiSuccess<T> | ApiError;

/** Build a success envelope. */
export function ok<T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> {
  if (meta !== undefined) return { ok: true, data, meta };
  return { ok: true, data };
}

/** Build an error envelope. `retryable` is derived from the code unless overridden. */
export function err(
  error_code: ErrorCode,
  message: string,
  opts: {
    next_action?: string;
    retryable?: boolean;
    fields?: Record<string, string>;
  } = {},
): ApiError {
  const retryable = opts.retryable ?? isRetryable(error_code);
  const out: ApiError = {
    ok: false,
    error_code,
    message,
    retryable,
  };
  if (opts.next_action !== undefined) out.next_action = opts.next_action;
  if (opts.fields !== undefined) out.fields = opts.fields;
  return out;
}

/** Type guard: narrows a result to the success branch. */
export function isOk<T>(r: ApiResult<T>): r is ApiSuccess<T> {
  return r.ok;
}

/** Type guard: narrows a result to the error branch. */
export function isErr<T>(r: ApiResult<T>): r is ApiError {
  return !r.ok;
}

/**
 * Convenience for route handlers: wrap a function that may throw.
 * Unknown errors become `internal_error`. Known ApiError values pass through.
 * Null/undefined results become `not_found` — silent null success is a footgun.
 */
export function envelope<T>(
  fn: () => T | ApiError,
): ApiResult<T> {
  try {
    const out = fn();
    if (
      out !== null &&
      typeof out === "object" &&
      "ok" in out &&
      out.ok === false
    ) {
      return out as ApiError;
    }
    if (out === null || out === undefined) {
      return err("not_found", "Resource not found.", {
        next_action: "Check the id and try again.",
      });
    }
    return ok(out as T);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return err("internal_error", message, {
      next_action: "Check server logs and retry.",
    });
  }
}
