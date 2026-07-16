/**
 * Idempotency guard — wraps a write tool so a retry with the same
 * idempotency_key returns the first response verbatim, with no duplicate write.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §4
 *         agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4.2
 *
 * Flow:
 *   1. idempotencyService.check(workspaceId, key, requestHash)
 *      - hit + same requestHash → return cached response (no domain call)
 *      - hit + different requestHash → idempotency_conflict error
 *      - miss → proceed
 *   2. run the domain mutation(s), build the response
 *   3. idempotencyService.record(...) — UNIQUE(workspace_id, idempotency_key)
 *      means a concurrent retry's insert loses silently; our response is the
 *      one the caller sees (the guard runs per-request, not globally locked).
 *
 * Read tools don't need this — they're side-effect free.
 */
import { idempotencyService, hashRequest, ConflictError } from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";

export interface GuardedToolResponse<T> {
  /** The tool response to return to the agent. */
  response: ApiResult<T>;
  /** True if this was an idempotency replay (no write happened). */
  replayed: boolean;
}

/**
 * Run a write tool under idempotency protection.
 *
 * @param db          DB client (workspace-scoped queries use workspaceId).
 * @param workspaceId Resolved from the token.
 * @param key         idempotency_key from the tool args. Required for write tools.
 * @param toolName    Tool name, stored on the record for audit.
 * @param requestArgs The full tool args object — hashed to detect key reuse.
 * @param run         The domain mutation + response builder. Only runs on a miss.
 */
export async function withIdempotency<T>(
  db: DbClient,
  workspaceId: string,
  key: string,
  toolName: string,
  requestArgs: unknown,
  run: () => Promise<ApiResult<T>>,
): Promise<GuardedToolResponse<T>> {
  if (!key?.trim()) {
    return {
      response: {
        ok: false,
        error_code: "validation_error",
        message: "idempotency_key is required for write tools",
        retryable: false,
      },
      replayed: false,
    };
  }

  const requestHash = await hashRequest(requestArgs);
  const hit = await idempotencyService.check(db, workspaceId, key, requestHash);

  if (hit.hit) {
    // Replay the canonical first response. If the cached blob is a valid
    // envelope, cast it; otherwise wrap the raw value.
    const cached = hit.response as ApiResult<T> | null;
    if (cached && typeof cached === "object" && "ok" in cached) {
      return { response: cached, replayed: true };
    }
    return {
      response: { ok: true, data: cached as T },
      replayed: true,
    };
  }

  // Miss → run the domain mutation, then record the response.
  let response: ApiResult<T>;
  try {
    response = await run();
  } catch (e) {
    // Idempotency key reused with different args surfaces as a conflict here.
    if (e instanceof ConflictError) {
      response = {
        ok: false,
        error_code: "idempotency_conflict",
        message: e.message,
        retryable: false,
      };
    } else {
      throw e;
    }
  }

  // Record even error responses? No — only success. A failed attempt should be
  // retryable with the same key (e.g. a validation error the agent fixes and
  // retries). We store the response only when ok, so a retry re-executes.
  if (response.ok) {
    await idempotencyService.record(db, workspaceId, key, toolName, requestHash, response);
  }

  return { response, replayed: false };
}
