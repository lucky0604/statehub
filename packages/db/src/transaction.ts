/**
 * Transaction wrapper with event append.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §8
 *
 *   mutation succeeds + event fails = rollback
 *   event succeeds + mutation fails = rollback
 *
 * P00 ships the INTERFACE only. P01A implements against D1's batch API:
 *
 *   await withEvent(db, {
 *     workspaceId,
 *     entityType: "work_item",
 *     entityId: workItem.id,
 *     eventType: "work_item.created",
 *     actor: { type: "user", name: "solo" },
 *     source: "user",
 *     payload: { after: workItem },
 *   }, async () => {
 *     // Return prepared statements — D1 runs them atomically with the event insert.
 *     const drizzleDb = drizzle(db);
 *     return [
 *       drizzleDb.insert(workItems).values(workItem).asStmt(),
 *     ];
 *   });
 *
 * D1 has no nested transactions. The atomic primitive is `db.batch([...stmts])`.
 * The mutation callback returns prepared statements; the implementation prepends
 * the event insert and runs them all in one batch. Either everything commits or
 * nothing does.
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { EventType } from "./schema/events";

export interface ActorContext {
  type: "user" | "remote_mcp" | "local_mcp" | "import" | "system_worker" | "ai_pm";
  id?: string;
  name: string;
}

export interface EventInput {
  workspaceId: string;
  projectId?: string;
  featureId?: string;
  workItemId?: string;
  entityType: string;
  entityId: string;
  eventType: EventType;
  actor: ActorContext;
  source: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
}

/**
 * Run a mutation atomically with an appended event.
 *
 * The mutation callback returns prepared statements. The implementation:
 *   1. Builds the event INSERT as a prepared statement.
 *   2. Runs `db.batch([eventStmt, ...mutationStmts])`.
 *
 * P00: interface only. P01A implements the batch call.
 */
export type WithEvent = (
  db: D1Database,
  event: EventInput,
  mutation: () => D1PreparedStatement[] | Promise<D1PreparedStatement[]>,
) => Promise<void>;
