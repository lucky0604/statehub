/**
 * Workspace service — CRUD for the top-level tenant boundary.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §3
 *
 * Workspaces are NOT workspace-scoped (they ARE the scope). Every other entity
 * requires a workspace_id; this one doesn't.
 */
import {
  type DbClient,
  type ActorContext,
  type Workspace,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapWorkspace } from "../mappers";
import { AlreadyExistsError, NotFoundError, ValidationError } from "../errors";

export interface CreateWorkspaceInput {
  slug: string;
  name: string;
  description?: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string | null;
}

export interface WorkspaceService {
  create(db: DbClient, actor: ActorContext, input: CreateWorkspaceInput): Promise<Workspace>;
  get(db: DbClient, workspaceId: string): Promise<Workspace | null>;
  getBySlug(db: DbClient, slug: string): Promise<Workspace | null>;
  list(db: DbClient): Promise<Workspace[]>;
  update(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    patch: UpdateWorkspaceInput,
  ): Promise<Workspace>;
  softDelete(db: DbClient, actor: ActorContext, workspaceId: string): Promise<void>;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;

function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new ValidationError(
      "slug must be 2-39 chars, lowercase alphanumeric + hyphens, start with alphanumeric",
    );
  }
}

interface NewWorkspaceRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
}

function newRow(id: string, input: CreateWorkspaceInput, actor: ActorContext): NewWorkspaceRow {
  return {
    id,
    slug: input.slug,
    name: input.name,
    description: input.description ?? null,
    version: 1,
    createdBy: actor.id ?? null,
    updatedBy: actor.id ?? null,
  };
}

function insertStmt(w: NewWorkspaceRow): { sql: string; params: SqlBindValue[] } {
  return {
    sql: `
      INSERT INTO workspaces (id, slug, name, description, version, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    params: [w.id, w.slug, w.name, w.description, w.version, w.createdBy, w.updatedBy],
  };
}

export const workspaceService: WorkspaceService = {
  async create(db, actor, input) {
    validateSlug(input.slug);
    if (!input.name?.trim()) {
      throw new ValidationError("name is required");
    }

    const existing = await db.first<{ id: string }>(
      "SELECT id FROM workspaces WHERE slug = ? AND deleted_at IS NULL",
      [input.slug],
    );
    if (existing) {
      throw new AlreadyExistsError("workspace", input.slug);
    }

    const id = crypto.randomUUID();
    const w = newRow(id, input, actor);

    await withEvent(
      db,
      {
        workspaceId: id,
        entityType: "workspace",
        entityId: id,
        eventType: "workspace.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { after: w },
      },
      () => [insertStmt(w)],
    );

    const row = await db.first<Record<string, unknown>>("SELECT * FROM workspaces WHERE id = ?", [id]);
    if (!row) throw new Error("workspace insert failed");
    return mapWorkspace(row);
  },

  async get(db, workspaceId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM workspaces WHERE id = ? AND deleted_at IS NULL",
      [workspaceId],
    );
    return row ? mapWorkspace(row) : null;
  },

  async getBySlug(db, slug) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM workspaces WHERE slug = ? AND deleted_at IS NULL",
      [slug],
    );
    return row ? mapWorkspace(row) : null;
  },

  async list(db) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at ASC",
    );
    return rows.map(mapWorkspace);
  },

  async update(db, actor, workspaceId, patch) {
    const existing = await workspaceService.get(db, workspaceId);
    if (!existing) throw new NotFoundError("workspace", workspaceId);

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
    if (sets.length === 0) return existing;

    sets.push("updated_at = unixepoch() * 1000");
    sets.push("version = version + 1");
    sets.push("updated_by = ?");
    params.push(actor.id ?? null);
    params.push(workspaceId);

    const updateSql = `UPDATE workspaces SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`;

    await withEvent(
      db,
      {
        workspaceId,
        entityType: "workspace",
        entityId: workspaceId,
        eventType: "workspace.updated",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing, after: patch },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM workspaces WHERE id = ?",
      [workspaceId],
    );
    if (!row) throw new Error("workspace update failed");
    return mapWorkspace(row);
  },

  async softDelete(db, actor, workspaceId) {
    const existing = await workspaceService.get(db, workspaceId);
    if (!existing) throw new NotFoundError("workspace", workspaceId);

    const sql =
      "UPDATE workspaces SET deleted_at = unixepoch() * 1000, version = version + 1, updated_by = ? WHERE id = ? AND deleted_at IS NULL";

    await withEvent(
      db,
      {
        workspaceId,
        entityType: "workspace",
        entityId: workspaceId,
        eventType: "workspace.deleted",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing },
      },
      () => [{ sql, params: [actor.id ?? null, workspaceId] }],
    );
  },
};
