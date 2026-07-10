/**
 * Domain errors. Each error class carries the API error code it should map to.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §6
 *
 * API routes catch these and convert to envelope responses.
 */
import type { ErrorCode } from "@statehub/shared/error-codes";

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super("not_found", `${resource} not found: ${id}`, { resource, id });
    this.name = "NotFoundError";
  }
}

export class AlreadyExistsError extends DomainError {
  constructor(resource: string, key: string) {
    super("conflict", `${resource} already exists: ${key}`, { resource, key });
    this.name = "AlreadyExistsError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super("conflict", message, extra);
    this.name = "ConflictError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super("validation_error", message, extra);
    this.name = "ValidationError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden") {
    super("forbidden", message);
    this.name = "ForbiddenError";
  }
}

/**
 * Detect a SQLite unique-constraint violation (better-sqlite3 SqliteError or
 * D1 error) and rethrow as AlreadyExistsError. Used to wrap the TOCTOU window
 * between a uniqueness pre-check and the INSERT: a concurrent dupe create would
 * otherwise surface as a raw 500 instead of a 409 conflict.
 */
export function rethrowUniqueViolation(
  resource: string,
  key: string,
  e: unknown,
): never {
  const msg = e instanceof Error ? e.message : String(e);
  // SQLITE_CONSTRAINT_UNIQUE code is 2067; both drivers also put "UNIQUE" in
  // the message. Match either to stay driver-agnostic.
  if (/unique constraint/i.test(msg) || /\bUNIQUE\b/.test(msg)) {
    throw new AlreadyExistsError(resource, key);
  }
  throw e;
}
