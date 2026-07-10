/**
 * Work item service — CRUD for the primary execution unit.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2, §4, §5
 *         agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2.2
 *
 * Sequence id:
 *   - allocated atomically via SequenceService (UPSERT-with-RETURNING)
 *   - unique within project (partial unique index where deleted_at IS NULL)
 *   - displayed as ${project_identifier}-${sequence_id} (e.g. KAVIS-1)
 *
 * status_group:
 *   - denormalized from the linked state's status_group at write time
 *   - kept on the work item so list/kanban queries don't need to join states
 *
 * changeStatus:
 *   - updates state_id + status_group together
 *   - sets completed_at when status_group becomes "completed", clears otherwise
 */
import {
  type DbClient,
  type ActorContext,
  type WorkItem,
  type WorkItemType,
  type Priority,
  type WorkItemSource,
  type ConfidenceLevel,
  type StatusGroup,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapWorkItem } from "../mappers";
import { sequenceService } from "./sequence";
import { NotFoundError, ValidationError } from "../errors";

export interface CreateWorkItemInput {
  title: string;
  descriptionMarkdown?: string;
  stateId?: string;
  type?: WorkItemType;
  priority?: Priority;
  source?: WorkItemSource;
  confidence?: ConfidenceLevel;
  featureId?: string;
  parentWorkItemId?: string;
  startDate?: number;
  targetDate?: number;
  sortOrder?: number;
}

export interface UpdateWorkItemInput {
  title?: string;
  descriptionMarkdown?: string | null;
  featureId?: string | null;
  priority?: Priority;
  type?: WorkItemType;
  confidence?: ConfidenceLevel;
  startDate?: number | null;
  targetDate?: number | null;
  sortOrder?: number;
}

export interface ListWorkItemsFilter {
  stateId?: string;
  statusGroup?: StatusGroup;
  featureId?: string | null;
  priority?: Priority;
  type?: WorkItemType;
  /** Filter to work items whose title/description match (LIKE). */
  search?: string;
  /** Default: 100. Max: 500. */
  limit?: number;
}

export interface WorkItemService {
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    projectId: string,
    input: CreateWorkItemInput,
  ): Promise<WorkItem>;
  get(db: DbClient, workspaceId: string, workItemId: string): Promise<WorkItem | null>;
  list(db: DbClient, workspaceId: string, projectId: string, filter?: ListWorkItemsFilter): Promise<WorkItem[]>;
  update(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    workItemId: string,
    patch: UpdateWorkItemInput,
  ): Promise<WorkItem>;
  changeStatus(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    workItemId: string,
    stateId: string,
  ): Promise<WorkItem>;
  softDelete(db: DbClient, actor: ActorContext, workspaceId: string, workItemId: string): Promise<void>;
}

interface ProjectRow {
  id: string;
  workspace_id: string;
  identifier: string;
  default_state_id: string | null;
}

interface StateRow {
  id: string;
  workspace_id: string;
  project_id: string;
  status_group: StatusGroup;
}

async function lookupProject(
  db: DbClient,
  workspaceId: string,
  projectId: string,
): Promise<ProjectRow> {
  const row = await db.first<ProjectRow>(
    "SELECT id, workspace_id, identifier, default_state_id FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [projectId, workspaceId],
  );
  if (!row) throw new NotFoundError("project", projectId);
  return row;
}

async function lookupState(
  db: DbClient,
  workspaceId: string,
  projectId: string,
  stateId: string,
): Promise<StateRow> {
  const row = await db.first<StateRow>(
    "SELECT id, workspace_id, project_id, status_group FROM states WHERE id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL",
    [stateId, workspaceId, projectId],
  );
  if (!row) throw new NotFoundError("state", stateId);
  return row;
}

export const workItemService: WorkItemService = {
  async create(db, actor, workspaceId, projectId, input) {
    if (!input.title?.trim()) throw new ValidationError("title is required");

    const project = await lookupProject(db, workspaceId, projectId);

    // Resolve state: explicit > project default > null (status_group backlog)
    let stateId = input.stateId ?? project.default_state_id ?? null;
    let statusGroup: StatusGroup = "backlog";
    if (stateId) {
      const state = await lookupState(db, workspaceId, projectId, stateId);
      statusGroup = state.status_group;
    } else {
      stateId = null;
    }

    const sequenceId = await sequenceService.next(db, projectId);

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      projectId,
      input.featureId ?? null,
      input.parentWorkItemId ?? null,
      sequenceId,
      project.identifier,
      input.title,
      input.descriptionMarkdown ?? null,
      stateId,
      statusGroup,
      input.type ?? "task",
      input.priority ?? "none",
      input.source ?? (actor.type === "user" ? "user" : actor.type),
      input.confidence ?? "none",
      input.startDate ?? null,
      input.targetDate ?? null,
      null, // completed_at
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
        workItemId: id,
        entityType: "work_item",
        entityId: id,
        eventType: "work_item.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          after: {
            id,
            sequenceId,
            identifier: `${project.identifier}-${sequenceId}`,
            title: input.title,
            stateId,
            statusGroup,
            type: input.type ?? "task",
            priority: input.priority ?? "none",
          },
        },
      },
      () => [
        {
          sql: `
            INSERT INTO work_items (
              id, workspace_id, project_id, feature_id, parent_work_item_id,
              sequence_id, project_identifier, title, description_markdown,
              state_id, status_group, type, priority, source, confidence,
              start_date, target_date, completed_at, sort_order,
              version, created_by, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM work_items WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("work item insert failed");
    return mapWorkItem(row);
  },

  async get(db, workspaceId, workItemId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM work_items WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [workItemId, workspaceId],
    );
    return row ? mapWorkItem(row) : null;
  },

  async list(db, workspaceId, projectId, filter = {}) {
    const where: string[] = [
      "workspace_id = ?",
      "project_id = ?",
      "deleted_at IS NULL",
    ];
    const params: SqlBindValue[] = [workspaceId, projectId];

    if (filter.stateId) {
      where.push("state_id = ?");
      params.push(filter.stateId);
    }
    if (filter.statusGroup) {
      where.push("status_group = ?");
      params.push(filter.statusGroup);
    }
    if (filter.featureId !== undefined) {
      if (filter.featureId === null) {
        where.push("feature_id IS NULL");
      } else {
        where.push("feature_id = ?");
        params.push(filter.featureId);
      }
    }
    if (filter.priority) {
      where.push("priority = ?");
      params.push(filter.priority);
    }
    if (filter.type) {
      where.push("type = ?");
      params.push(filter.type);
    }
    if (filter.search) {
      where.push("(title LIKE ? OR description_markdown LIKE ?)");
      const like = `%${filter.search}%`;
      params.push(like, like);
    }

    const limit = Math.min(filter.limit ?? 100, 500);

    const sql = `
      SELECT * FROM work_items
      WHERE ${where.join(" AND ")}
      ORDER BY sort_order ASC, sequence_id DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = await db.all<Record<string, unknown>>(sql, params);
    return rows.map(mapWorkItem);
  },

  async update(db, actor, workspaceId, workItemId, patch) {
    const existing = await workItemService.get(db, workspaceId, workItemId);
    if (!existing) throw new NotFoundError("work_item", workItemId);

    const sets: string[] = [];
    const params: SqlBindValue[] = [];
    if (patch.title !== undefined) {
      if (!patch.title.trim()) throw new ValidationError("title cannot be empty");
      sets.push("title = ?");
      params.push(patch.title);
    }
    if (patch.descriptionMarkdown !== undefined) {
      sets.push("description_markdown = ?");
      params.push(patch.descriptionMarkdown);
    }
    if (patch.featureId !== undefined) {
      sets.push("feature_id = ?");
      params.push(patch.featureId);
    }
    if (patch.priority !== undefined) {
      sets.push("priority = ?");
      params.push(patch.priority);
    }
    if (patch.type !== undefined) {
      sets.push("type = ?");
      params.push(patch.type);
    }
    if (patch.confidence !== undefined) {
      sets.push("confidence = ?");
      params.push(patch.confidence);
    }
    if (patch.startDate !== undefined) {
      sets.push("start_date = ?");
      params.push(patch.startDate);
    }
    if (patch.targetDate !== undefined) {
      sets.push("target_date = ?");
      params.push(patch.targetDate);
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
    params.push(workItemId);
    params.push(workspaceId);

    const updateSql = `UPDATE work_items SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`;

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        workItemId,
        entityType: "work_item",
        entityId: workItemId,
        eventType: "work_item.updated",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing, after: patch },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM work_items WHERE id = ?",
      [workItemId],
    );
    if (!row) throw new Error("work item update failed");
    return mapWorkItem(row);
  },

  async changeStatus(db, actor, workspaceId, workItemId, stateId) {
    const existing = await workItemService.get(db, workspaceId, workItemId);
    if (!existing) throw new NotFoundError("work_item", workItemId);

    const state = await lookupState(db, workspaceId, existing.projectId, stateId);

    if (existing.stateId === stateId) return existing;

    // set completed_at when entering "completed", clear otherwise
    const completedAtExpr =
      state.status_group === "completed" ? "unixepoch() * 1000" : "NULL";

    const sql = `
      UPDATE work_items
      SET state_id = ?, status_group = ?, completed_at = ${completedAtExpr},
          updated_at = unixepoch() * 1000, version = version + 1, updated_by = ?
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
    `;

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        workItemId,
        entityType: "work_item",
        entityId: workItemId,
        eventType: "work_item.status_changed",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          before: { stateId: existing.stateId, statusGroup: existing.statusGroup },
          after: { stateId, statusGroup: state.status_group },
        },
      },
      () => [{ sql, params: [stateId, state.status_group, actor.id ?? null, workItemId, workspaceId] }],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM work_items WHERE id = ?",
      [workItemId],
    );
    if (!row) throw new Error("work item status update failed");
    return mapWorkItem(row);
  },

  async softDelete(db, actor, workspaceId, workItemId) {
    const existing = await workItemService.get(db, workspaceId, workItemId);
    if (!existing) throw new NotFoundError("work_item", workItemId);

    const sql =
      "UPDATE work_items SET deleted_at = unixepoch() * 1000, version = version + 1, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL";

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        workItemId,
        entityType: "work_item",
        entityId: workItemId,
        eventType: "work_item.deleted",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing },
      },
      () => [{ sql, params: [actor.id ?? null, workItemId, workspaceId] }],
    );
  },
};
