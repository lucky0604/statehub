/**
 * Project service — CRUD for workspace-scoped projects.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §3, §4
 *         agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2
 *
 * On create, seeds 6 default states and 8 default labels in the same batch
 * (atomic — project never exists without its defaults).
 */
import {
  type DbClient,
  type ActorContext,
  type Project,
  type ProjectType,
  type ProjectStatus,
  type PortfolioPriority,
  PROJECT_TYPES,
  PROJECT_STATUSES,
  PORTFOLIO_PRIORITIES,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapProject } from "../mappers";
import { AlreadyExistsError, NotFoundError, ValidationError } from "../errors";

export interface CreateProjectInput {
  slug: string;
  name: string;
  identifier: string;
  description?: string;
  type?: ProjectType;
  status?: ProjectStatus;
  portfolioPriority?: PortfolioPriority;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  defaultStateId?: string | null;
  defaultAssigneeId?: string | null;
  type?: ProjectType | null;
  status?: ProjectStatus;
  portfolioPriority?: PortfolioPriority;
}

export interface ProjectService {
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: CreateProjectInput,
  ): Promise<Project>;
  get(db: DbClient, workspaceId: string, projectId: string): Promise<Project | null>;
  getBySlug(db: DbClient, workspaceId: string, slug: string): Promise<Project | null>;
  list(db: DbClient, workspaceId: string): Promise<Project[]>;
  update(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    projectId: string,
    patch: UpdateProjectInput,
  ): Promise<Project>;
  softDelete(db: DbClient, actor: ActorContext, workspaceId: string, projectId: string): Promise<void>;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const IDENTIFIER_RE = /^[A-Z][A-Z0-9]{2,5}$/;

interface DefaultState {
  name: string;
  statusGroup: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  color: string;
  sortOrder: number;
}

const DEFAULT_STATES: DefaultState[] = [
  { name: "Backlog", statusGroup: "backlog", color: "#9CA3AF", sortOrder: 0 },
  { name: "Todo", statusGroup: "unstarted", color: "#6B7280", sortOrder: 1 },
  { name: "In Progress", statusGroup: "started", color: "#3B82F6", sortOrder: 2 },
  { name: "In Review", statusGroup: "started", color: "#8B5CF6", sortOrder: 3 },
  { name: "Done", statusGroup: "completed", color: "#10B981", sortOrder: 4 },
  { name: "Dropped", statusGroup: "cancelled", color: "#EF4444", sortOrder: 5 },
];

const DEFAULT_LABELS: { name: string; color: string; sortOrder: number }[] = [
  { name: "feature", color: "#3B82F6", sortOrder: 0 },
  { name: "bug", color: "#EF4444", sortOrder: 1 },
  { name: "docs", color: "#6B7280", sortOrder: 2 },
  { name: "infra", color: "#F59E0B", sortOrder: 3 },
  { name: "ai", color: "#8B5CF6", sortOrder: 4 },
  { name: "mcp", color: "#EC4899", sortOrder: 5 },
  { name: "review-fix", color: "#14B8A6", sortOrder: 6 },
  { name: "release", color: "#0EA5E9", sortOrder: 7 },
];

function validateInput(input: CreateProjectInput): void {
  if (!SLUG_RE.test(input.slug)) {
    throw new ValidationError(
      "slug must be 2-39 chars, lowercase alphanumeric + hyphens, start with alphanumeric",
    );
  }
  if (!IDENTIFIER_RE.test(input.identifier)) {
    throw new ValidationError(
      "identifier must be 3-6 chars, uppercase alphanumeric, start with a letter",
    );
  }
  if (!input.name?.trim()) {
    throw new ValidationError("name is required");
  }
  if (input.type !== undefined && input.type !== null && !PROJECT_TYPES.includes(input.type)) {
    throw new ValidationError(`type must be one of: ${PROJECT_TYPES.join(", ")}`);
  }
  if (input.status !== undefined && !PROJECT_STATUSES.includes(input.status)) {
    throw new ValidationError(`status must be one of: ${PROJECT_STATUSES.join(", ")}`);
  }
  if (
    input.portfolioPriority !== undefined &&
    !PORTFOLIO_PRIORITIES.includes(input.portfolioPriority)
  ) {
    throw new ValidationError(
      `portfolioPriority must be one of: ${PORTFOLIO_PRIORITIES.join(", ")}`,
    );
  }
}

/** Validate the enum fields that may appear in a PATCH (type may be nulled). */
function validatePatchEnums(patch: UpdateProjectInput): void {
  if (
    patch.type !== undefined &&
    patch.type !== null &&
    !PROJECT_TYPES.includes(patch.type)
  ) {
    throw new ValidationError(`type must be one of: ${PROJECT_TYPES.join(", ")}`);
  }
  if (patch.status !== undefined && !PROJECT_STATUSES.includes(patch.status)) {
    throw new ValidationError(`status must be one of: ${PROJECT_STATUSES.join(", ")}`);
  }
  if (
    patch.portfolioPriority !== undefined &&
    !PORTFOLIO_PRIORITIES.includes(patch.portfolioPriority)
  ) {
    throw new ValidationError(
      `portfolioPriority must be one of: ${PORTFOLIO_PRIORITIES.join(", ")}`,
    );
  }
}

interface NewProjectRow {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  identifier: string;
  defaultStateId: string | null;
  defaultAssigneeId: string | null;
  type: string | null;
  status: string;
  portfolioPriority: string;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
}

function projectInsertStmt(p: NewProjectRow): { sql: string; params: SqlBindValue[] } {
  return {
    sql: `
      INSERT INTO projects (
        id, workspace_id, slug, name, description, identifier,
        default_state_id, default_assignee_id,
        type, status, portfolio_priority,
        version, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      p.id,
      p.workspaceId,
      p.slug,
      p.name,
      p.description ?? null,
      p.identifier,
      p.defaultStateId ?? null,
      p.defaultAssigneeId ?? null,
      p.type ?? null,
      p.status,
      p.portfolioPriority,
      p.version,
      p.createdBy ?? null,
      p.updatedBy ?? null,
    ],
  };
}

function stateInsertStmt(s: {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  statusGroup: string;
  color: string;
  sortOrder: number;
  createdBy: string | null;
}): { sql: string; params: SqlBindValue[] } {
  return {
    sql: `
      INSERT INTO states (
        id, workspace_id, project_id, name, status_group, color, sort_order, version, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      s.id,
      s.workspaceId,
      s.projectId,
      s.name,
      s.statusGroup,
      s.color,
      s.sortOrder,
      1,
      s.createdBy,
      s.createdBy,
    ],
  };
}

function labelInsertStmt(l: {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  color: string;
  sortOrder: number;
  createdBy: string | null;
}): { sql: string; params: SqlBindValue[] } {
  return {
    sql: `
      INSERT INTO labels (
        id, workspace_id, project_id, name, color, sort_order, version, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      l.id,
      l.workspaceId,
      l.projectId,
      l.name,
      l.color,
      l.sortOrder,
      1,
      l.createdBy,
      l.createdBy,
    ],
  };
}

function counterInsertStmt(projectId: string): { sql: string; params: SqlBindValue[] } {
  return {
    sql: "INSERT INTO project_counters (project_id, last_sequence) VALUES (?, 0)",
    params: [projectId],
  };
}

export const projectService: ProjectService = {
  async create(db, actor, workspaceId, input) {
    validateInput(input);

    const existingSlug = await db.first<{ id: string }>(
      "SELECT id FROM projects WHERE workspace_id = ? AND slug = ? AND deleted_at IS NULL",
      [workspaceId, input.slug],
    );
    if (existingSlug) throw new AlreadyExistsError("project", input.slug);

    const existingIdentifier = await db.first<{ id: string }>(
      "SELECT id FROM projects WHERE workspace_id = ? AND identifier = ? AND deleted_at IS NULL",
      [workspaceId, input.identifier],
    );
    if (existingIdentifier) throw new AlreadyExistsError("project", input.identifier);

    const projectId = crypto.randomUUID();
    const stateIds = DEFAULT_STATES.map(() => crypto.randomUUID());

    const newProject: NewProjectRow = {
      id: projectId,
      workspaceId,
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      identifier: input.identifier,
      defaultStateId: stateIds[0] ?? null, // Backlog
      defaultAssigneeId: null,
      type: input.type ?? null,
      status: input.status ?? "active",
      portfolioPriority: input.portfolioPriority ?? "P1",
      version: 1,
      createdBy: actor.id ?? null,
      updatedBy: actor.id ?? null,
    };

    const stmts: { sql: string; params: SqlBindValue[] }[] = [
      projectInsertStmt(newProject),
      counterInsertStmt(projectId),
    ];
    for (let i = 0; i < DEFAULT_STATES.length; i++) {
      const s = DEFAULT_STATES[i]!;
      stmts.push(
        stateInsertStmt({
          id: stateIds[i]!,
          workspaceId,
          projectId,
          name: s.name,
          statusGroup: s.statusGroup,
          color: s.color,
          sortOrder: s.sortOrder,
          createdBy: actor.id ?? null,
        }),
      );
    }
    for (let i = 0; i < DEFAULT_LABELS.length; i++) {
      const l = DEFAULT_LABELS[i]!;
      stmts.push(
        labelInsertStmt({
          id: crypto.randomUUID(),
          workspaceId,
          projectId,
          name: l.name,
          color: l.color,
          sortOrder: l.sortOrder,
          createdBy: actor.id ?? null,
        }),
      );
    }

    await withEvent(
      db,
      {
        workspaceId,
        entityType: "project",
        entityId: projectId,
        eventType: "project.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          after: newProject,
          defaults: { states: DEFAULT_STATES.length, labels: DEFAULT_LABELS.length },
        },
      },
      () => stmts,
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM projects WHERE id = ?",
      [projectId],
    );
    if (!row) throw new Error("project insert failed");
    return mapProject(row);
  },

  async get(db, workspaceId, projectId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [projectId, workspaceId],
    );
    return row ? mapProject(row) : null;
  },

  async getBySlug(db, workspaceId, slug) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM projects WHERE workspace_id = ? AND slug = ? AND deleted_at IS NULL",
      [workspaceId, slug],
    );
    return row ? mapProject(row) : null;
  },

  async list(db, workspaceId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM projects WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
      [workspaceId],
    );
    return rows.map(mapProject);
  },

  async update(db, actor, workspaceId, projectId, patch) {
    const existing = await projectService.get(db, workspaceId, projectId);
    if (!existing) throw new NotFoundError("project", projectId);

    validatePatchEnums(patch);

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
    if (patch.defaultStateId !== undefined) {
      sets.push("default_state_id = ?");
      params.push(patch.defaultStateId);
    }
    if (patch.defaultAssigneeId !== undefined) {
      sets.push("default_assignee_id = ?");
      params.push(patch.defaultAssigneeId);
    }
    if (patch.type !== undefined) {
      sets.push("type = ?");
      params.push(patch.type);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (patch.portfolioPriority !== undefined) {
      sets.push("portfolio_priority = ?");
      params.push(patch.portfolioPriority);
    }
    if (sets.length === 0) return existing;

    sets.push("updated_at = unixepoch() * 1000");
    sets.push("version = version + 1");
    sets.push("updated_by = ?");
    params.push(actor.id ?? null);
    params.push(projectId);
    params.push(workspaceId);

    const updateSql = `UPDATE projects SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`;

    await withEvent(
      db,
      {
        workspaceId,
        projectId,
        entityType: "project",
        entityId: projectId,
        eventType: "project.updated",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing, after: patch },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM projects WHERE id = ?",
      [projectId],
    );
    if (!row) throw new Error("project update failed");
    return mapProject(row);
  },

  async softDelete(db, actor, workspaceId, projectId) {
    const existing = await projectService.get(db, workspaceId, projectId);
    if (!existing) throw new NotFoundError("project", projectId);

    const sql =
      "UPDATE projects SET deleted_at = unixepoch() * 1000, version = version + 1, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL";

    await withEvent(
      db,
      {
        workspaceId,
        projectId,
        entityType: "project",
        entityId: projectId,
        eventType: "project.deleted",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { before: existing },
      },
      () => [{ sql, params: [actor.id ?? null, projectId, workspaceId] }],
    );
  },
};
