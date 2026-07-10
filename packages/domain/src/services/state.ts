/**
 * State service — CRUD for per-project work item states.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2.1
 *
 * States are workspace+project scoped. Every method enforces workspace_id —
 * never trust a state id without verifying it belongs to the right workspace.
 */
import {
  type DbClient,
  type ActorContext,
  type State,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapState } from "../mappers";
import { NotFoundError, ValidationError } from "../errors";

export interface CreateStateInput {
  name: string;
  statusGroup: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  color?: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateStateInput {
  name?: string;
  color?: string | null;
  description?: string | null;
  sortOrder?: number;
}

export interface StateService {
  list(db: DbClient, workspaceId: string, projectId: string): Promise<State[]>;
  get(db: DbClient, workspaceId: string, stateId: string): Promise<State | null>;
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    projectId: string,
    input: CreateStateInput,
  ): Promise<State>;
  update(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    stateId: string,
    patch: UpdateStateInput,
  ): Promise<State>;
  softDelete(db: DbClient, actor: ActorContext, workspaceId: string, stateId: string): Promise<void>;
}

export const stateService: StateService = {
  async list(db, workspaceId, projectId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM states WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
      [workspaceId, projectId],
    );
    return rows.map(mapState);
  },

  async get(db, workspaceId, stateId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM states WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [stateId, workspaceId],
    );
    return row ? mapState(row) : null;
  },

  async create(db, actor, workspaceId, projectId, input) {
    if (!input.name?.trim()) throw new ValidationError("name is required");

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      projectId,
      input.name,
      input.description ?? null,
      input.statusGroup,
      input.color ?? null,
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
        entityType: "state",
        entityId: id,
        eventType: "state.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { after: { id, projectId, name: input.name, statusGroup: input.statusGroup } },
      },
      () => [
        {
          sql: `
            INSERT INTO states (
              id, workspace_id, project_id, name, description, status_group, color, sort_order, version, created_by, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM states WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("state insert failed");
    return mapState(row);
  },

  async update(db, actor, workspaceId, stateId, patch) {
    const existing = await stateService.get(db, workspaceId, stateId);
    if (!existing) throw new NotFoundError("state", stateId);

    const sets: string[] = [];
    const params: SqlBindValue[] = [];
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new ValidationError("name cannot be empty");
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.color !== undefined) {
      sets.push("color = ?");
      params.push(patch.color);
    }
    if (patch.description !== undefined) {
      sets.push("description = ?");
      params.push(patch.description);
    }
    if (patch.sortOrder !== undefined) {
      sets.push("sort_order = ?");
      params.push(patch.sortOrder);
    }
    if (sets.length === 0) return existing;

    sets.push("updated_at = unixepoch() * 1000");
    sets.push("version = version + 1");
    sets.push("updated_by = ?");
    params.push(actor.id ?? null);
    params.push(stateId);
    params.push(workspaceId);

    const updateSql = `UPDATE states SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`;

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        entityType: "state",
        entityId: stateId,
        eventType: "state.updated",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing, after: patch },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM states WHERE id = ?",
      [stateId],
    );
    if (!row) throw new Error("state update failed");
    return mapState(row);
  },

  async softDelete(db, actor, workspaceId, stateId) {
    const existing = await stateService.get(db, workspaceId, stateId);
    if (!existing) throw new NotFoundError("state", stateId);

    const sql =
      "UPDATE states SET deleted_at = unixepoch() * 1000, version = version + 1, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL";

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        entityType: "state",
        entityId: stateId,
        eventType: "state.deleted",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing },
      },
      () => [{ sql, params: [actor.id ?? null, stateId, workspaceId] }],
    );
  },
};
