/**
 * Label service — CRUD for per-project work item labels.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2.1
 */
import {
  type DbClient,
  type ActorContext,
  type Label,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapLabel } from "../mappers";
import { NotFoundError, ValidationError } from "../errors";

export interface CreateLabelInput {
  name: string;
  color?: string;
  sortOrder?: number;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string | null;
  sortOrder?: number;
}

export interface LabelService {
  list(db: DbClient, workspaceId: string, projectId: string): Promise<Label[]>;
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    projectId: string,
    input: CreateLabelInput,
  ): Promise<Label>;
  update(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    labelId: string,
    patch: UpdateLabelInput,
  ): Promise<Label>;
  softDelete(db: DbClient, actor: ActorContext, workspaceId: string, labelId: string): Promise<void>;
}

export const labelService: LabelService = {
  async list(db, workspaceId, projectId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM labels WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
      [workspaceId, projectId],
    );
    return rows.map(mapLabel);
  },

  async create(db, actor, workspaceId, projectId, input) {
    if (!input.name?.trim()) throw new ValidationError("name is required");

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      projectId,
      input.name,
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
        entityType: "label",
        entityId: id,
        eventType: "label.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { after: { id, projectId, name: input.name } },
      },
      () => [
        {
          sql: `
            INSERT INTO labels (
              id, workspace_id, project_id, name, color, sort_order, version, created_by, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM labels WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("label insert failed");
    return mapLabel(row);
  },

  async update(db, actor, workspaceId, labelId, patch) {
    const row0 = await db.first<Record<string, unknown>>(
      "SELECT * FROM labels WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [labelId, workspaceId],
    );
    if (!row0) throw new NotFoundError("label", labelId);
    const existing = mapLabel(row0);

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
    if (patch.sortOrder !== undefined) {
      sets.push("sort_order = ?");
      params.push(patch.sortOrder);
    }
    if (sets.length === 0) return existing;

    sets.push("updated_at = unixepoch() * 1000");
    sets.push("version = version + 1");
    sets.push("updated_by = ?");
    params.push(actor.id ?? null);
    params.push(labelId);
    params.push(workspaceId);

    const updateSql = `UPDATE labels SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`;

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        entityType: "label",
        entityId: labelId,
        eventType: "label.updated",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing, after: patch },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM labels WHERE id = ?",
      [labelId],
    );
    if (!row) throw new Error("label update failed");
    return mapLabel(row);
  },

  async softDelete(db, actor, workspaceId, labelId) {
    const row0 = await db.first<Record<string, unknown>>(
      "SELECT * FROM labels WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [labelId, workspaceId],
    );
    if (!row0) throw new NotFoundError("label", labelId);
    const existing = mapLabel(row0);

    const sql =
      "UPDATE labels SET deleted_at = unixepoch() * 1000, version = version + 1, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL";

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        entityType: "label",
        entityId: labelId,
        eventType: "label.deleted",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing },
      },
      () => [{ sql, params: [actor.id ?? null, labelId, workspaceId] }],
    );
  },
};
