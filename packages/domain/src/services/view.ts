/**
 * View service — CRUD for saved filter+display presets.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2.3, §4.6
 *         agent_flow/statehub-design-system.md §10.4
 *         agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §3
 *
 * A view is a named preset of the work-items filter (query) + display (layout,
 * group_by, order_by, visible_columns). Applying a view writes its filters into
 * the URL — the URL is the source of truth at render time.
 *
 * Name is unique within (project_id, owner_id) among non-deleted views. owner_id
 * is null for solo dev.
 */
import {
  type DbClient,
  type ActorContext,
  type View,
  type ViewLayout,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapView } from "../mappers";
import { AlreadyExistsError, NotFoundError, ValidationError, rethrowUniqueViolation } from "../errors";

/**
 * Stored filter spec (query_json). Mirrors the work-items list filter, with
 * arrays for repeatable filters. Kept as JSON so the schema doesn't need a
 * column per filter.
 */
export interface ViewQuery {
  stateIds?: string[];
  statusGroups?: string[];
  priorities?: string[];
  labelIds?: string[];
  featureId?: string | null;
  source?: string[];
  confidence?: string[];
  search?: string;
}

export interface ViewDisplay {
  groupBy?: string;
  orderBy?: string;
  visibleColumns?: string[];
}

export interface CreateViewInput {
  name: string;
  layout?: ViewLayout;
  query: ViewQuery;
  display?: ViewDisplay;
  sortOrder?: number;
}

export interface UpdateViewInput {
  name?: string;
  layout?: ViewLayout;
  query?: ViewQuery;
  display?: ViewDisplay;
  sortOrder?: number;
}

export interface ViewService {
  list(db: DbClient, workspaceId: string, projectId: string): Promise<View[]>;
  get(db: DbClient, workspaceId: string, viewId: string): Promise<View | null>;
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    projectId: string,
    input: CreateViewInput,
  ): Promise<View>;
  update(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    viewId: string,
    patch: UpdateViewInput,
  ): Promise<View>;
  softDelete(db: DbClient, actor: ActorContext, workspaceId: string, viewId: string): Promise<void>;
}

/** Parse a view's query_json safely; returns {} on invalid/empty. */
export function parseViewQuery(json: string): ViewQuery {
  try {
    return JSON.parse(json) as ViewQuery;
  } catch {
    return {};
  }
}

/** Parse a view's display_json safely; returns {} on invalid/empty. */
export function parseViewDisplay(json: string): ViewDisplay {
  try {
    return JSON.parse(json) as ViewDisplay;
  } catch {
    return {};
  }
}

export const viewService: ViewService = {
  async list(db, workspaceId, projectId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM views WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
      [workspaceId, projectId],
    );
    return rows.map(mapView);
  },

  async get(db, workspaceId, viewId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM views WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [viewId, workspaceId],
    );
    return row ? mapView(row) : null;
  },

  async create(db, actor, workspaceId, projectId, input) {
    if (!input.name?.trim()) throw new ValidationError("name is required");

    const layout: ViewLayout = input.layout ?? "list";

    const existing = await db.first<{ id: string }>(
      "SELECT id FROM views WHERE project_id = ? AND owner_id IS NULL AND name = ? AND deleted_at IS NULL",
      [projectId, input.name],
    );
    if (existing) throw new AlreadyExistsError("view", input.name);

    const id = crypto.randomUUID();
    const queryJson = JSON.stringify(input.query ?? {});
    const displayJson = JSON.stringify(input.display ?? {});
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      projectId,
      null, // owner_id — solo dev
      input.name,
      layout,
      queryJson,
      displayJson,
      0, // is_default
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
        entityType: "view",
        entityId: id,
        eventType: "view.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { after: { id, projectId, name: input.name, layout, query: input.query } },
      },
      () => [
        {
          sql: `
            INSERT INTO views (
              id, workspace_id, project_id, owner_id, name, layout,
              query_json, display_json, is_default, sort_order, version, created_by, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          params,
        },
      ],
    ).catch((e) => rethrowUniqueViolation("view", input.name, e));

    const row = await db.first<Record<string, unknown>>("SELECT * FROM views WHERE id = ?", [id]);
    if (!row) throw new Error("view insert failed");
    return mapView(row);
  },

  async update(db, actor, workspaceId, viewId, patch) {
    const existing = await viewService.get(db, workspaceId, viewId);
    if (!existing) throw new NotFoundError("view", viewId);

    const sets: string[] = [];
    const params: SqlBindValue[] = [];
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new ValidationError("name cannot be empty");
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.layout !== undefined) {
      sets.push("layout = ?");
      params.push(patch.layout);
    }
    if (patch.query !== undefined) {
      sets.push("query_json = ?");
      params.push(JSON.stringify(patch.query));
    }
    if (patch.display !== undefined) {
      sets.push("display_json = ?");
      params.push(JSON.stringify(patch.display));
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
    params.push(viewId);
    params.push(workspaceId);

    const updateSql = `UPDATE views SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`;

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        entityType: "view",
        entityId: viewId,
        eventType: "view.updated",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing, after: patch },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>("SELECT * FROM views WHERE id = ?", [
      viewId,
    ]);
    if (!row) throw new Error("view update failed");
    return mapView(row);
  },

  async softDelete(db, actor, workspaceId, viewId) {
    const existing = await viewService.get(db, workspaceId, viewId);
    if (!existing) throw new NotFoundError("view", viewId);

    const sql =
      "UPDATE views SET deleted_at = unixepoch() * 1000, version = version + 1, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL";

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        entityType: "view",
        entityId: viewId,
        eventType: "view.deleted",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing },
      },
      () => [{ sql, params: [actor.id ?? null, viewId, workspaceId] }],
    );
  },
};
