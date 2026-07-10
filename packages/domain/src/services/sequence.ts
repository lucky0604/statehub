/**
 * Sequence service — allocates per-project sequence ids for work items.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §5
 *
 * The sequence id is unique within a project (KAVIS-1, KAVIS-2, ...) and never
 * reused. Allocated atomically using UPSERT-with-RETURNING on project_counters.
 *
 * Note: the allocation is in its own statement, NOT in the work-item-insert
 * batch. If the insert fails, the sequence has a gap. This is acceptable for
 * solo dev — the PRD explicitly says sequences are never reused.
 */
import type { DbClient } from "@statehub/db";

export interface SequenceService {
  /** Atomically allocate and return the next sequence id for a project. */
  next(db: DbClient, projectId: string): Promise<number>;
  /** Read the current counter value without incrementing (0 if no row). */
  current(db: DbClient, projectId: string): Promise<number>;
}

export const sequenceService: SequenceService = {
  async next(db, projectId) {
    const sql = `
      INSERT INTO project_counters (project_id, last_sequence)
      VALUES (?, 1)
      ON CONFLICT(project_id) DO UPDATE SET last_sequence = last_sequence + 1
      RETURNING last_sequence
    `;
    const row = await db.first<{ last_sequence: number }>(sql, [projectId]);
    if (!row) {
      // Should be impossible — UPSERT always returns a row.
      throw new Error(`sequence allocation failed for project ${projectId}`);
    }
    return row.last_sequence;
  },

  async current(db, projectId) {
    const row = await db.first<{ last_sequence: number }>(
      "SELECT last_sequence FROM project_counters WHERE project_id = ?",
      [projectId],
    );
    return row?.last_sequence ?? 0;
  },
};
