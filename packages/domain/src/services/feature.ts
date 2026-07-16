/**
 * Feature service — CRUD for deliverable groupings under a project.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2
 *         agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §10
 *
 * Status state machine:
 *   backlog -> planned -> in_progress -> needs_review -> done
 *   needs_review -> needs_changes -> in_progress
 *   done -> reopened
 *
 * `changeStatus` enforces allowed transitions and emits feature.status_changed
 * (separate from feature.updated for entity-wide edits).
 */
import {
  type DbClient,
  type ActorContext,
  type Feature,
  type FeatureStatus,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapFeature } from "../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../errors";

export interface CreateFeatureInput {
  name: string;
  description?: string;
  status?: FeatureStatus;
  sortOrder?: number;
}

export interface UpdateFeatureInput {
  name?: string;
  description?: string | null;
  sortOrder?: number;
}

export interface FeatureService {
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    projectId: string,
    input: CreateFeatureInput,
  ): Promise<Feature>;
  get(db: DbClient, workspaceId: string, featureId: string): Promise<Feature | null>;
  list(db: DbClient, workspaceId: string, projectId: string): Promise<Feature[]>;
  update(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    featureId: string,
    patch: UpdateFeatureInput,
  ): Promise<Feature>;
  changeStatus(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    featureId: string,
    newStatus: FeatureStatus,
  ): Promise<Feature>;
  softDelete(db: DbClient, actor: ActorContext, workspaceId: string, featureId: string): Promise<void>;
}

const ALLOWED_TRANSITIONS: Record<FeatureStatus, FeatureStatus[]> = {
  backlog: ["planned"],
  planned: ["in_progress", "backlog"],
  in_progress: ["needs_review", "needs_changes", "done", "planned"],
  needs_review: ["needs_changes", "done", "in_progress"],
  needs_changes: ["in_progress"],
  done: ["reopened"],
  reopened: ["in_progress", "done"],
};

function assertTransition(from: FeatureStatus, to: FeatureStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictError(
      `feature status transition not allowed: ${from} -> ${to}`,
      { from, to, allowed },
    );
  }
}

export const featureService: FeatureService = {
  async create(db, actor, workspaceId, projectId, input) {
    if (!input.name?.trim()) throw new ValidationError("name is required");
    const status = input.status ?? "backlog";

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      projectId,
      input.name,
      input.description ?? null,
      status,
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
        entityType: "feature",
        entityId: id,
        eventType: "feature.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { after: { id, projectId, name: input.name, status } },
      },
      () => [
        {
          sql: `
            INSERT INTO features (
              id, workspace_id, project_id, name, description, status, sort_order, version, created_by, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM features WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("feature insert failed");
    return mapFeature(row);
  },

  async get(db, workspaceId, featureId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM features WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [featureId, workspaceId],
    );
    return row ? mapFeature(row) : null;
  },

  async list(db, workspaceId, projectId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM features WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
      [workspaceId, projectId],
    );
    return rows.map(mapFeature);
  },

  async update(db, actor, workspaceId, featureId, patch) {
    const existing = await featureService.get(db, workspaceId, featureId);
    if (!existing) throw new NotFoundError("feature", featureId);

    const sets: string[] = [];
    const params: SqlBindValue[] = [];
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new ValidationError("name cannot be empty");
      sets.push("name = ?");
      params.push(patch.name);
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
    params.push(featureId);
    params.push(workspaceId);

    const updateSql = `UPDATE features SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`;

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        featureId,
        entityType: "feature",
        entityId: featureId,
        eventType: "feature.updated",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing, after: patch },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM features WHERE id = ?",
      [featureId],
    );
    if (!row) throw new Error("feature update failed");
    return mapFeature(row);
  },

  async changeStatus(db, actor, workspaceId, featureId, newStatus) {
    const existing = await featureService.get(db, workspaceId, featureId);
    if (!existing) throw new NotFoundError("feature", featureId);

    if (existing.status === newStatus) return existing;
    assertTransition(existing.status, newStatus);

    const sql =
      "UPDATE features SET status = ?, updated_at = unixepoch() * 1000, version = version + 1, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL";

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        featureId,
        entityType: "feature",
        entityId: featureId,
        eventType: "feature.status_changed",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing.status, after: newStatus },
      },
      () => [{ sql, params: [newStatus, actor.id ?? null, featureId, workspaceId] }],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM features WHERE id = ?",
      [featureId],
    );
    if (!row) throw new Error("feature status update failed");
    return mapFeature(row);
  },

  async softDelete(db, actor, workspaceId, featureId) {
    const existing = await featureService.get(db, workspaceId, featureId);
    if (!existing) throw new NotFoundError("feature", featureId);

    const sql =
      "UPDATE features SET deleted_at = unixepoch() * 1000, version = version + 1, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL";

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        featureId,
        entityType: "feature",
        entityId: featureId,
        eventType: "feature.deleted",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing },
      },
      () => [{ sql, params: [actor.id ?? null, featureId, workspaceId] }],
    );
  },
};
