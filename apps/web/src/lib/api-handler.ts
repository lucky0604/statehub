/**
 * API route helper — wraps a handler in the canonical envelope and maps
 * DomainError instances to the right HTTP status + error code.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §6
 */
import { ok, err, type ErrorCode } from "@statehub/shared";
import { DomainError, ValidationError, NotFoundError } from "@statehub/domain";

export type Params = Record<string, string | string[]>;

type Handler<T> = (req: Request, params: Params) => Promise<T>;

function errorStatus(code: ErrorCode): number {
  switch (code) {
    case "not_found":
      return 404;
    case "forbidden":
    case "scope_missing":
    case "unauthorized":
      return 403;
    case "conflict":
    case "idempotency_conflict":
    case "workspace_mismatch":
    case "transition_not_allowed":
      return 409;
    case "validation_error":
      return 400;
    case "rate_limited":
      return 429;
    case "external_source_error":
      return 502;
    case "internal_error":
      return 500;
    default:
      return 500;
  }
}

/**
 * Wrap a handler so its return value becomes `ok(data)` and its throws become
 * `err(code, message, extra)` with the right HTTP status.
 */
export function withEnvelope<T>(handler: Handler<T>) {
  return async (req: Request, ctx: { params: Promise<Params> }): Promise<Response> => {
    try {
      const params = ctx.params ? await ctx.params : {};
      const data = await handler(req, params);
      return Response.json(ok(data));
    } catch (e) {
      if (e instanceof DomainError) {
        return Response.json(err(e.code, e.message, e.extra), {
          status: errorStatus(e.code),
        });
      }
      const msg = e instanceof Error ? e.message : "internal error";
      console.error("[api] unhandled error:", e);
      return Response.json(err("internal_error", msg), { status: 500 });
    }
  };
}

/** Parse a JSON request body. Returns {} if the body is empty. */
export async function parseBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ValidationError("request body is not valid JSON");
  }
}

/** Get a single string param, throwing if it's missing or an array. */
export function param(params: Params, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || !v) {
    throw new ValidationError(`missing param: ${key}`);
  }
  return v;
}

/**
 * Assert a required request-body field is present. Throws ValidationError
 * (maps to 400) — NOT a raw Error, which would map to 500.
 */
export function required<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null || value === "") {
    throw new ValidationError(`${field} is required`);
  }
  return value;
}

/** Parse a query string into a record of string|undefined (first value wins). */
export function query(req: Request): Record<string, string | undefined> {
  const u = new URL(req.url);
  const out: Record<string, string | undefined> = {};
  u.searchParams.forEach((value, key) => {
    if (out[key] === undefined) out[key] = value;
  });
  return out;
}

/** Return the value or throw NotFoundError. Use for "get by id" lookups. */
export function or404<T>(value: T | null, resource: string, id: string): T {
  if (value === null) throw new NotFoundError(resource, id);
  return value;
}
