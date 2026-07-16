/**
 * Idempotency service — replay protection for external agent retries.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §4
 *         agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4.2
 *
 * Flow for a write tool:
 *   1. idempotencyService.check(workspaceId, key, requestHash)
 *      - if a record exists with the SAME requestHash → return { hit, response }
 *      - if a record exists with a DIFFERENT requestHash → conflict (key reused)
 *      - else → { hit: false }
 *   2. run the domain mutation, build the response
 *   3. idempotencyService.record(workspaceId, key, toolName, requestHash, response)
 *      - INSERT; if a concurrent retry already inserted (UNIQUE violation),
 *        re-read and return the stored response instead of failing.
 *
 * The cached response is the full tool response JSON, replayed verbatim.
 */
import { type DbClient, type SqlBindValue } from "@statehub/db";
import { ConflictError } from "../errors";

export interface IdempotencyHit {
  hit: boolean;
  /** Present when hit=true and the requestHash matches. */
  response: unknown | null;
}

export interface IdempotencyService {
  check(
    db: DbClient,
    workspaceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<IdempotencyHit>;
  record(
    db: DbClient,
    workspaceId: string,
    idempotencyKey: string,
    toolName: string,
    requestHash: string,
    response: unknown,
  ): Promise<void>;
}

export const idempotencyService: IdempotencyService = {
  async check(db, workspaceId, idempotencyKey, requestHash) {
    const row = await db.first<{ response_json: string; request_hash: string }>(
      "SELECT response_json, request_hash FROM idempotency_records WHERE workspace_id = ? AND idempotency_key = ?",
      [workspaceId, idempotencyKey],
    );
    if (!row) return { hit: false, response: null };
    if (row.request_hash !== requestHash) {
      // Same key, different args — that's a client bug, not a retry.
      throw new ConflictError(
        `idempotency_key reused with different request args: ${idempotencyKey}`,
        { idempotencyKey },
      );
    }
    try {
      return { hit: true, response: JSON.parse(row.response_json) };
    } catch {
      return { hit: true, response: null };
    }
  },

  async record(db, workspaceId, idempotencyKey, toolName, requestHash, response) {
    const id = crypto.randomUUID();
    const responseJson = JSON.stringify(response);
    try {
      await db.run(
        `INSERT INTO idempotency_records (id, workspace_id, idempotency_key, tool_name, request_hash, response_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, workspaceId, idempotencyKey, toolName, requestHash, responseJson] as SqlBindValue[],
      );
    } catch {
      // UNIQUE(workspace_id, idempotency_key) — a concurrent retry already
      // recorded. That's fine: the first writer's response is the canonical one.
      // Re-reading isn't necessary here; the caller's response is discarded by
      // the guard that wraps the whole tool call.
    }
  },
};

/** SHA-256 hex of a JSON-serializable request, for requestHash. */
export async function hashRequest(args: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(args ?? {}));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
