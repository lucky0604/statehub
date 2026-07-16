/**
 * idempotency_records — replay protection for external agent retries.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §4
 *         agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4.2
 *
 * Keyed by (workspace_id, idempotency_key) with a UNIQUE constraint: a retry
 * with the same key hits the constraint and falls back to reading the stored
 * response — the domain mutation does NOT run again.
 *
 * response_json is the full tool response, replayed verbatim on retry.
 *
 * Append-only (no soft-delete, no version): a record is permanent proof that
 * this key was processed.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const idempotencyRecords = sqliteTable(
  "idempotency_records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    toolName: text("tool_name").notNull(),
    /** SHA-256 of the request args, to detect key reuse with different args. */
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("idx_idem_workspace_key").on(table.workspaceId, table.idempotencyKey),
    index("idx_idem_workspace_created").on(table.workspaceId, table.createdAt),
  ],
);

export type IdempotencyRecord = typeof idempotencyRecords.$inferSelect;
export type NewIdempotencyRecord = typeof idempotencyRecords.$inferInsert;
