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
  /** Single state (legacy single-value filter). */
  stateId?: string;
  /** Repeatable: any of these state ids. */
  stateIds?: string[];
  statusGroup?: StatusGroup;
  /** Repeatable: any of these status groups. */
  statusGroups?: StatusGroup[];
  featureId?: string | null;
  priority?: Priority;
  /** Repeatable: any of these priorities. */
  priorities?: Priority[];
  type?: WorkItemType;
  /** Repeatable: work items tagged with ANY of these label ids. */
  labelIds?: string[];
  /** Repeatable: any of these sources. */
  sources?: WorkItemSource[];
  /** Repeatable: any of these confidence levels. */
  confidences?: ConfidenceLevel[];
  /** Filter to work items whose title/description match (LIKE). */
  search?: string;
  /** Default: 100. Max: 500. */
  limit?: number;
  /** Order: 'sequence' | 'updated' | 'priority'. Default 'sequence'. */
  orderBy?: "sequence" | "updated" | "priority";
}

/** Sortable work-item fields → SQL ORDER BY fragment. */
const ORDER_BY_SQL: Record<NonNullable<ListWorkItemsFilter["orderBy"]>, string> = {
  sequence: "sequence_id DESC",
  updated: "updated_at DESC",
  priority: "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, sequence_id DESC",
};

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
  /** Replace a work item's label set. Assigns the union; removes any not listed. */
  setLabels(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    workItemId: string,
    labelIds: string[],
  ): Promise<string[]>;
  /** Return the label ids currently assigned to a work item. */
  listLabelIds(db: DbClient, workspaceId: string, workItemId: string): Promise<string[]>;
  /** Change state on many work items. One event per item (each atomic). */
  bulkChangeStatus(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    workItemIds: string[],
    stateId: string,
  ): Promise<{ updated: string[]; skipped: string[] }>;
  /** Recent events for an entity (feeds Peek activity). */
  listEvents(
    db: DbClient,
    workspaceId: string,
    entityType: string,
    entityId: string,
    limit?: number,
  ): Promise<EventRow[]>;
}

export interface EventRow {
  id: string;
  eventType: string;
  actorType: string;
  actorName: string;
  source: string;
  payloadJson: string;
  createdAt: number;
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

    // state: combine single stateId + repeatable stateIds (deduped)
    const stateIds = new Set<string>();
    if (filter.stateId) stateIds.add(filter.stateId);
    if (filter.stateIds) for (const s of filter.stateIds) stateIds.add(s);
    if (stateIds.size === 1) {
      where.push("state_id = ?");
      params.push([...stateIds][0]!);
    } else if (stateIds.size > 1) {
      where.push(`state_id IN (${Array.from(stateIds).map(() => "?").join(",")})`);
      for (const s of stateIds) params.push(s);
    }

    // status_group: combine single + repeatable
    const statusGroups = new Set<StatusGroup>();
    if (filter.statusGroup) statusGroups.add(filter.statusGroup);
    if (filter.statusGroups) for (const g of filter.statusGroups) statusGroups.add(g);
    if (statusGroups.size === 1) {
      where.push("status_group = ?");
      params.push([...statusGroups][0]!);
    } else if (statusGroups.size > 1) {
      where.push(`status_group IN (${Array.from(statusGroups).map(() => "?").join(",")})`);
      for (const g of statusGroups) params.push(g);
    }

    if (filter.featureId !== undefined) {
      if (filter.featureId === null) {
        where.push("feature_id IS NULL");
      } else {
        where.push("feature_id = ?");
        params.push(filter.featureId);
      }
    }

    // priority: combine single + repeatable
    const priorities = new Set<Priority>();
    if (filter.priority) priorities.add(filter.priority);
    if (filter.priorities) for (const p of filter.priorities) priorities.add(p);
    if (priorities.size === 1) {
      where.push("priority = ?");
      params.push([...priorities][0]!);
    } else if (priorities.size > 1) {
      where.push(`priority IN (${Array.from(priorities).map(() => "?").join(",")})`);
      for (const p of priorities) params.push(p);
    }

    if (filter.type) {
      where.push("type = ?");
      params.push(filter.type);
    }

    if (filter.sources && filter.sources.length > 0) {
      where.push(`source IN (${filter.sources.map(() => "?").join(",")})`);
      for (const s of filter.sources) params.push(s);
    }

    if (filter.confidences && filter.confidences.length > 0) {
      where.push(`confidence IN (${filter.confidences.map(() => "?").join(",")})`);
      for (const c of filter.confidences) params.push(c);
    }

    // labels: work items tagged with ANY of the given label ids (join)
    if (filter.labelIds && filter.labelIds.length > 0) {
      where.push(
        `id IN (SELECT work_item_id FROM work_item_labels WHERE label_id IN (${filter.labelIds.map(() => "?").join(",")}))`,
      );
      for (const l of filter.labelIds) params.push(l);
    }

    if (filter.search) {
      where.push("(title LIKE ? OR description_markdown LIKE ?)");
      const like = `%${filter.search}%`;
      params.push(like, like);
    }

    const limit = Math.min(filter.limit ?? 100, 500);
    const orderBy = ORDER_BY_SQL[filter.orderBy ?? "sequence"];

    const sql = `
      SELECT * FROM work_items
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}, sort_order ASC
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

  async setLabels(db, actor, workspaceId, workItemId, labelIds) {
    const existing = await workItemService.get(db, workspaceId, workItemId);
    if (!existing) throw new NotFoundError("work_item", workItemId);

    // Fetch current assigned labels.
    const currentRows = await db.all<{ label_id: string }>(
      "SELECT label_id FROM work_item_labels WHERE work_item_id = ?",
      [workItemId],
    );
    const current = new Set(currentRows.map((r) => r.label_id));
    const next = new Set(labelIds);

    const toAdd = [...next].filter((l) => !current.has(l));
    const toRemove = [...current].filter((l) => !next.has(l));

    // Verify added labels belong to the same workspace+project.
    if (toAdd.length > 0) {
      const validRows = await db.all<{ id: string }>(
        `SELECT id FROM labels WHERE id IN (${toAdd.map(() => "?").join(",")}) AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL`,
        [...toAdd, workspaceId, existing.projectId],
      );
      const valid = new Set(validRows.map((r) => r.id));
      for (const l of toAdd) {
        if (!valid.has(l)) throw new NotFoundError("label", l);
      }
    }

    const stmts: { sql: string; params: SqlBindValue[] }[] = [];
    for (const labelId of toAdd) {
      // INSERT OR IGNORE: if the assignment already exists (race / stale UI),
      // skip it instead of throwing a PK-violation 500. setLabels is idempotent.
      stmts.push({
        sql: "INSERT OR IGNORE INTO work_item_labels (workspace_id, work_item_id, label_id) VALUES (?, ?, ?)",
        params: [workspaceId, workItemId, labelId],
      });
    }
    for (const labelId of toRemove) {
      stmts.push({
        sql: "DELETE FROM work_item_labels WHERE work_item_id = ? AND label_id = ?",
        params: [workItemId, labelId],
      });
    }

    if (stmts.length === 0) return [...next];

    // Append a single work_item.labels_changed event in the same batch.
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
        payload: { before: { labelIds: [...current] }, after: { labelIds: [...next] } },
      },
      () => stmts,
    );

    return [...next];
  },

  async listLabelIds(db, workspaceId, workItemId) {
    // Verify the work item exists in this workspace (isolation).
    const wi = await workItemService.get(db, workspaceId, workItemId);
    if (!wi) return [];
    const rows = await db.all<{ label_id: string }>(
      "SELECT label_id FROM work_item_labels WHERE work_item_id = ?",
      [workItemId],
    );
    return rows.map((r) => r.label_id);
  },

  async bulkChangeStatus(db, actor, workspaceId, workItemIds, stateId) {
    // Pre-validate the target state exists in this workspace. If it doesn't,
    // every item would fail the state lookup inside changeStatus — better to
    // surface that as a single NotFoundError than a silent all-skipped result
    // (P01B review: M2).
    //
    // We look it up against the first item's project; if there are no items we
    // can't know the project, so verify it exists in-workspace at all.
    const firstItem =
      workItemIds.length > 0 ? await workItemService.get(db, workspaceId, workItemIds[0]!) : null;
    if (firstItem) {
      // Throws NotFoundError if the state is missing or belongs to another project.
      await lookupState(db, workspaceId, firstItem.projectId, stateId);
    } else {
      // No valid first item: still confirm the state exists somewhere in workspace.
      const stateRow = await db.first<{ id: string }>(
        "SELECT id FROM states WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
        [stateId, workspaceId],
      );
      if (!stateRow) throw new NotFoundError("state", stateId);
    }

    const updated: string[] = [];
    const skipped: string[] = [];
    for (const id of workItemIds) {
      try {
        const item = await workItemService.get(db, workspaceId, id);
        if (!item) {
          skipped.push(id);
          continue;
        }
        // Skip no-ops: an item already in the target state is not "updated"
        // (no mutation, no event). (P01B review: M3.)
        if (item.stateId === stateId) {
          skipped.push(id);
          continue;
        }
        await workItemService.changeStatus(db, actor, workspaceId, id, stateId);
        updated.push(id);
      } catch {
        skipped.push(id);
      }
    }
    return { updated, skipped };
  },

  async listEvents(db, workspaceId, entityType, entityId, limit = 50) {
    const cap = Math.min(limit, 200);
    const rows = await db.all<Record<string, unknown>>(
      `SELECT id, event_type, actor_type, actor_name, source, payload_json, created_at
       FROM events
       WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [workspaceId, entityType, entityId, cap],
    );
    return rows.map((r) => ({
      id: r.id as string,
      eventType: r.event_type as string,
      actorType: r.actor_type as string,
      actorName: r.actor_name as string,
      source: r.source as string,
      payloadJson: r.payload_json as string,
      createdAt: r.created_at as number,
    }));
  },
};
