/**
 * Transaction wrapper with event append.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §8
 *
 *   mutation succeeds + event fails = rollback
 *   event succeeds + mutation fails = rollback
 *
 * The atomic primitive is `db.batch([...stmts])` — works on both D1 (production)
 * and better-sqlite3 (local dev). The mutation callback returns SQL statements
 * as `{ sql, params }` pairs; the implementation prepends the event INSERT and
 * runs them all in one batch. Either everything commits or nothing does.
 */
import type { DbClient, SqlBindValue, SqlStmt } from "./db-client";
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
 * The mutation callback returns SQL statements. The implementation:
 *   1. Builds the event INSERT as a SqlStmt.
 *   2. Runs `db.batch([eventStmt, ...mutationStmts])`.
 *
 * Either everything commits or nothing does.
 */
export type WithEvent = (
  db: DbClient,
  event: EventInput,
  mutation: () => SqlStmt[] | Promise<SqlStmt[]>,
) => Promise<void>;

/**
 * Build the event INSERT statement.
 *
 * Exposed so services can compose their own batches when they need to (e.g.
 * sequence allocation + work item insert + event append in one batch).
 */
export function buildEventStmt(event: EventInput): SqlStmt {
  const id = crypto.randomUUID();
  const sql = `
    INSERT INTO events (
      id, workspace_id, project_id, feature_id, work_item_id,
      entity_type, entity_id, event_type,
      actor_type, actor_id, actor_name,
      source, idempotency_key, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000)
  `;
  const params: SqlBindValue[] = [
    id,
    event.workspaceId,
    event.projectId ?? null,
    event.featureId ?? null,
    event.workItemId ?? null,
    event.entityType,
    event.entityId,
    event.eventType,
    event.actor.type,
    event.actor.id ?? null,
    event.actor.name,
    event.source,
    event.idempotencyKey ?? null,
    JSON.stringify(event.payload),
  ];
  return { sql, params };
}

/**
 * Concrete withEvent implementation. Builds the event INSERT, runs it together
 * with the mutation's statements in one atomic batch.
 */
export const withEvent: WithEvent = async (db, event, mutation) => {
  const eventStmt = buildEventStmt(event);
  const mutationStmts = await mutation();
  await db.batch([eventStmt, ...mutationStmts]);
};
