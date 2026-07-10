/**
 * project_counters — per-project sequence counter.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §4
 *
 * One row per project. last_sequence is incremented atomically in a D1 batch
 * alongside the work item insert, guaranteeing no duplicate sequence IDs even
 * under concurrent writes.
 *
 * NOT soft-deletable — this is a counter, not a business entity. When a project
 * is soft-deleted, the counter row stays (sequence numbers are never reused).
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const projectCounters = sqliteTable("project_counters", {
  projectId: text("project_id").primaryKey(),
  lastSequence: integer("last_sequence").notNull().default(0),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type ProjectCounter = typeof projectCounters.$inferSelect;
export type NewProjectCounter = typeof projectCounters.$inferInsert;
