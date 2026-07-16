/**
 * Weekly review service — save + list weekly reviews.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md §3.4, §6.3
 *
 * A weekly review is a structured snapshot of the workspace (or a single
 * project) for a week window. It is produced by the AI PM's weekly_review
 * mode and saved by the user via the save_weekly_review action card.
 *
 * Reviews are append-only in v1. Re-running for the same week creates a
 * new row; the UI shows the most recent by created_at.
 */
import {
  type DbClient,
  type ActorContext,
  type WeeklyReview,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapWeeklyReview } from "../mappers";
import { ValidationError } from "../errors";

export interface WeeklyReviewService {
  save(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: SaveWeeklyReviewInput,
  ): Promise<WeeklyReview>;
  list(
    db: DbClient,
    workspaceId: string,
    filter?: { projectId?: string | null },
  ): Promise<WeeklyReview[]>;
  get(db: DbClient, workspaceId: string, reviewId: string): Promise<WeeklyReview | null>;
}

export interface SaveWeeklyReviewInput {
  projectId?: string | null;
  weekStart: number;
  weekEnd: number;
  summaryJson: string;
}

const MAX_SUMMARY_BYTES = 64 * 1024;

export const weeklyReviewService: WeeklyReviewService = {
  async save(db, actor, workspaceId, input) {
    if (!Number.isFinite(input.weekStart) || !Number.isFinite(input.weekEnd)) {
      throw new ValidationError("week_start and week_end must be finite epoch ms");
    }
    if (input.weekEnd < input.weekStart) {
      throw new ValidationError("week_end must be ≥ week_start");
    }
    if (!input.summaryJson?.trim()) {
      throw new ValidationError("summary_json is required");
    }
    // Validate it parses as JSON.
    try {
      JSON.parse(input.summaryJson);
    } catch {
      throw new ValidationError("summary_json must be valid JSON");
    }
    if (Buffer.byteLength(input.summaryJson, "utf8") > MAX_SUMMARY_BYTES) {
      throw new ValidationError(`summary_json must be ≤ ${MAX_SUMMARY_BYTES} bytes`);
    }

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      input.projectId ?? null,
      input.weekStart,
      input.weekEnd,
      input.summaryJson,
      actor.id ?? null,
    ];

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId ?? undefined,
        entityType: "weekly_review",
        entityId: id,
        eventType: "weekly_review.saved",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          weekStart: input.weekStart,
          weekEnd: input.weekEnd,
          projectId: input.projectId ?? null,
          summaryBytes: Buffer.byteLength(input.summaryJson, "utf8"),
        },
      },
      () => [
        {
          sql: `INSERT INTO weekly_reviews
            (id, workspace_id, project_id, week_start, week_end, summary_json, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM weekly_reviews WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("weekly review insert failed");
    return mapWeeklyReview(row);
  },

  async list(db, workspaceId, filter) {
    if (filter?.projectId !== undefined) {
      if (filter.projectId === null) {
        const rows = await db.all<Record<string, unknown>>(
          "SELECT * FROM weekly_reviews WHERE workspace_id = ? AND project_id IS NULL ORDER BY week_start DESC, created_at DESC",
          [workspaceId],
        );
        return rows.map(mapWeeklyReview);
      }
      const rows = await db.all<Record<string, unknown>>(
        "SELECT * FROM weekly_reviews WHERE workspace_id = ? AND project_id = ? ORDER BY week_start DESC, created_at DESC",
        [workspaceId, filter.projectId],
      );
      return rows.map(mapWeeklyReview);
    }
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM weekly_reviews WHERE workspace_id = ? ORDER BY week_start DESC, created_at DESC",
      [workspaceId],
    );
    return rows.map(mapWeeklyReview);
  },

  async get(db, workspaceId, reviewId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM weekly_reviews WHERE id = ? AND workspace_id = ?",
      [reviewId, workspaceId],
    );
    return row ? mapWeeklyReview(row) : null;
  },
};
