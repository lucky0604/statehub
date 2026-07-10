/**
 * Cycle service — minimal CRUD for time-boxed work-item groupings.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2
 *
 * P01B ships create + list only. Cycle→work-item assignment and cycle-scoped
 * filtering land in a later iteration; the `cycle` URL key is reserved.
 */
import {
  type DbClient,
  type ActorContext,
  type Cycle,
  type CycleStatus,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapCycle } from "../mappers";
import { AlreadyExistsError, ValidationError, rethrowUniqueViolation } from "../errors";

export interface CreateCycleInput {
  name: string;
  status?: CycleStatus;
  startDate?: number;
  endDate?: number;
  sortOrder?: number;
}

export interface CycleService {
  list(db: DbClient, workspaceId: string, projectId: string): Promise<Cycle[]>;
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    projectId: string,
    input: CreateCycleInput,
  ): Promise<Cycle>;
}

export const cycleService: CycleService = {
  async list(db, workspaceId, projectId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM cycles WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
      [workspaceId, projectId],
    );
    return rows.map(mapCycle);
  },

  async create(db, actor, workspaceId, projectId, input) {
    if (!input.name?.trim()) throw new ValidationError("name is required");
    const status: CycleStatus = input.status ?? "active";

    const existing = await db.first<{ id: string }>(
      "SELECT id FROM cycles WHERE project_id = ? AND name = ? AND deleted_at IS NULL",
      [projectId, input.name],
    );
    if (existing) throw new AlreadyExistsError("cycle", input.name);

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      projectId,
      input.name,
      status,
      input.startDate ?? null,
      input.endDate ?? null,
      input.sortOrder ?? 0,
      1,
      actor.id ?? null,
      actor.id ?? null,
    ];

    await withEvent(
      db,
      {
        workspaceId,
        projectId,
        entityType: "cycle",
        entityId: id,
        eventType: "cycle.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { after: { id, projectId, name: input.name, status } },
      },
      () => [
        {
          sql: `
            INSERT INTO cycles (
              id, workspace_id, project_id, name, status, start_date, end_date,
              sort_order, version, created_by, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          params,
        },
      ],
    ).catch((e) => rethrowUniqueViolation("cycle", input.name, e));

    const row = await db.first<Record<string, unknown>>("SELECT * FROM cycles WHERE id = ?", [id]);
    if (!row) throw new Error("cycle insert failed");
    return mapCycle(row);
  },
};
