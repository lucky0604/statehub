/**
 * Todo service — checklist items under a work item / feature / agent run.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §3.2, §4.0
 *
 * Todos are NOT primary planning entities. Per the Work Item-Backed Agent Rule,
 * agent-created tasks that affect scope/schedule/completion must be work items;
 * todos are implementation subtasks, checklists, and ephemeral execution notes.
 *
 * P02A ships create + update_status. Upsert-with-merge (fingerprint dedup) is
 * P02B; the merge guard is reserved there.
 *
 * update_status rules (phase-02 §4):
 *   - transition to 'done' with evidence_required=1 requires an evidence_summary
 *   - records from_status/to_status in the event payload
 *   - completing sets completed_at; cancelling/done are terminal-ish (no guard)
 */
import {
  type DbClient,
  type ActorContext,
  type Todo,
  type TodoStatus,
  type TodoType,
  type Priority,
  type ConfidenceLevel,
  type WorkItemSource,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapTodo } from "../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../errors";

export interface CreateTodoInput {
  projectId: string;
  featureId?: string;
  workItemId?: string;
  agentRunId?: string;
  title: string;
  description?: string;
  type?: TodoType;
  priority?: Priority;
  source?: WorkItemSource;
  confidence?: ConfidenceLevel;
  evidenceRequired?: number;
  evidenceSummary?: string;
  sortOrder?: number;
}

export interface UpdateTodoStatusInput {
  status: TodoStatus;
  evidenceSummary?: string;
  agentRunId?: string;
  /**
   * Optional optimistic-concurrency check (P02B). If provided AND mismatched
   * with the current version, throws ConflictError. If absent, the check is
   * skipped. Full conflict surface (Reload/Apply/Dismiss) is P03.
   */
  expectedVersion?: number;
}

/**
 * Upsert input (P02B). Merge fingerprint is
 *   (workspace_id, project_id, parent_id, lower(title))
 * where parent_id = work_item_id ?? feature_id ?? agent_run_id ?? NULL.
 * At least one parent field SHOULD be set — todos are not free-floating
 * (Work Item-Backed Agent Rule, phase-02 §4.0).
 */
export interface UpsertTodoInput {
  projectId: string;
  featureId?: string;
  workItemId?: string;
  agentRunId?: string;
  title: string;
  description?: string;
  type?: TodoType;
  priority?: Priority;
  source?: WorkItemSource;
  confidence?: ConfidenceLevel;
  evidenceRequired?: number;
  evidenceSummary?: string;
  sortOrder?: number;
}

export interface UpsertTodoResult {
  todo: Todo;
  action: "created" | "updated" | "noop";
}

export interface TodoService {
  create(db: DbClient, actor: ActorContext, workspaceId: string, input: CreateTodoInput): Promise<Todo>;
  /**
   * Create-or-merge by fingerprint (workspace, project, parent_id, lower(title)).
   * parent_id = work_item_id ?? feature_id ?? agent_run_id ?? NULL. On hit,
   * merges non-null fields and bumps version. On miss, inserts with status='backlog'.
   */
  upsert(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: UpsertTodoInput,
  ): Promise<UpsertTodoResult>;
  updateStatus(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    todoId: string,
    input: UpdateTodoStatusInput,
  ): Promise<Todo>;
  get(db: DbClient, workspaceId: string, todoId: string): Promise<Todo | null>;
  listForWorkItem(db: DbClient, workspaceId: string, workItemId: string): Promise<Todo[]>;
  listForFeature(db: DbClient, workspaceId: string, featureId: string): Promise<Todo[]>;
  listForAgentRun(db: DbClient, workspaceId: string, agentRunId: string): Promise<Todo[]>;
}

async function lookupProject(
  db: DbClient,
  workspaceId: string,
  projectId: string,
): Promise<{ id: string }> {
  const row = await db.first<{ id: string }>(
    "SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [projectId, workspaceId],
  );
  if (!row) throw new NotFoundError("project", projectId);
  return row;
}

/**
 * Validate that the provided parent (feature / work_item / agent_run) exists
 * in this workspace. At least one parent should be set for agent upserts;
 * we don't hard-fail on none (a feature-scoped todo with no parent is legal
 * but unusual) — the caller's validation_error handles the explicit rule.
 */
async function validateParents(
  db: DbClient,
  workspaceId: string,
  input: UpsertTodoInput,
): Promise<void> {
  if (input.featureId) {
    const r = await db.first<{ id: string }>(
      "SELECT id FROM features WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [input.featureId, workspaceId],
    );
    if (!r) throw new NotFoundError("feature", input.featureId);
  }
  if (input.workItemId) {
    const r = await db.first<{ id: string }>(
      "SELECT id FROM work_items WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [input.workItemId, workspaceId],
    );
    if (!r) throw new NotFoundError("work_item", input.workItemId);
  }
  if (input.agentRunId) {
    const r = await db.first<{ id: string }>(
      "SELECT id FROM agent_runs WHERE id = ? AND workspace_id = ?",
      [input.agentRunId, workspaceId],
    );
    if (!r) throw new NotFoundError("agent_run", input.agentRunId);
  }
}

export const todoService: TodoService = {
  async create(db, actor, workspaceId, input) {
    if (!input.title?.trim()) throw new ValidationError("title is required");
    await lookupProject(db, workspaceId, input.projectId);

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      input.projectId,
      input.featureId ?? null,
      input.workItemId ?? null,
      input.agentRunId ?? null,
      input.title,
      input.description ?? null,
      "backlog",
      input.type ?? "implementation",
      input.priority ?? "none",
      input.source ?? "remote_mcp",
      input.confidence ?? "none",
      input.evidenceRequired ?? 0,
      input.evidenceSummary ?? null,
      input.sortOrder ?? 0,
      1,
      actor.id ?? null,
      actor.id ?? null,
    ];

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId,
        featureId: input.featureId,
        workItemId: input.workItemId,
        entityType: "todo",
        entityId: id,
        eventType: "todo.created",
        actor,
        source: actor.type,
        payload: {
          id,
          projectId: input.projectId,
          featureId: input.featureId ?? null,
          workItemId: input.workItemId ?? null,
          agentRunId: input.agentRunId ?? null,
          title: input.title,
          type: input.type ?? "implementation",
        },
      },
      () => [
        {
          sql: `INSERT INTO todos (
            id, workspace_id, project_id, feature_id, work_item_id, agent_run_id,
            title, description, status, type, priority, source, confidence,
            evidence_required, evidence_summary, sort_order, version, created_by, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>("SELECT * FROM todos WHERE id = ?", [id]);
    if (!row) throw new Error("todo insert failed");
    return mapTodo(row);
  },

  async upsert(db, actor, workspaceId, input) {
    if (!input.title?.trim()) throw new ValidationError("title is required");
    await lookupProject(db, workspaceId, input.projectId);
    await validateParents(db, workspaceId, input);

    // Fingerprint lookup: same workspace + project + parent (whichever is set
    // first by priority) + lower(title), not soft-deleted.
    const existing = await db.first<{ id: string }>(
      `SELECT id FROM todos
       WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL
         AND COALESCE(work_item_id, '') = COALESCE(?, '')
         AND COALESCE(feature_id, '') = COALESCE(?, '')
         AND COALESCE(agent_run_id, '') = COALESCE(?, '')
         AND lower(title) = lower(?)`,
      [
        workspaceId,
        input.projectId,
        input.workItemId ?? null,
        input.featureId ?? null,
        input.agentRunId ?? null,
        input.title,
      ],
    );

    const source = input.source ?? (actor.type === "user" ? "user" : "remote_mcp");
    const confidence = input.confidence ?? (actor.type === "user" ? "none" : "low");

    if (!existing) {
      const id = crypto.randomUUID();
      const params: SqlBindValue[] = [
        id,
        workspaceId,
        input.projectId,
        input.featureId ?? null,
        input.workItemId ?? null,
        input.agentRunId ?? null,
        input.title,
        input.description ?? null,
        "backlog",
        input.type ?? "implementation",
        input.priority ?? "none",
        source,
        confidence,
        input.evidenceRequired ?? 0,
        input.evidenceSummary ?? null,
        input.sortOrder ?? 0,
        1,
        actor.id ?? null,
        actor.id ?? null,
      ];

      await withEvent(
        db,
        {
          workspaceId,
          projectId: input.projectId,
          featureId: input.featureId,
          workItemId: input.workItemId,
          entityType: "todo",
          entityId: id,
          eventType: "todo.created",
          actor,
          source: actor.type,
          payload: {
            id,
            projectId: input.projectId,
            featureId: input.featureId ?? null,
            workItemId: input.workItemId ?? null,
            agentRunId: input.agentRunId ?? null,
            title: input.title,
            type: input.type ?? "implementation",
            via: "upsert",
          },
        },
        () => [
          {
            sql: `INSERT INTO todos (
              id, workspace_id, project_id, feature_id, work_item_id, agent_run_id,
              title, description, status, type, priority, source, confidence,
              evidence_required, evidence_summary, sort_order, version, created_by, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params,
          },
        ],
      );

      const row = await db.first<Record<string, unknown>>("SELECT * FROM todos WHERE id = ?", [id]);
      if (!row) throw new Error("todo upsert insert failed");
      return { todo: mapTodo(row), action: "created" as const };
    }

    // Merge: update fields whose value actually changes. Title is the fingerprint — not updated.
    const existingRow = await db.first<Record<string, unknown>>(
      "SELECT * FROM todos WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [existing.id, workspaceId],
    );
    if (!existingRow) throw new NotFoundError("todo", existing.id);
    const existingTodo = mapTodo(existingRow);

    const sets: string[] = [];
    const params: SqlBindValue[] = [];
    if (input.description !== undefined && input.description !== existingTodo.description) {
      sets.push("description = ?");
      params.push(input.description);
    }
    if (input.type !== undefined && input.type !== existingTodo.type) {
      sets.push("type = ?");
      params.push(input.type);
    }
    if (input.priority !== undefined && input.priority !== existingTodo.priority) {
      sets.push("priority = ?");
      params.push(input.priority);
    }
    if (input.evidenceRequired !== undefined && input.evidenceRequired !== existingTodo.evidenceRequired) {
      sets.push("evidence_required = ?");
      params.push(input.evidenceRequired);
    }
    if (input.evidenceSummary !== undefined && input.evidenceSummary !== existingTodo.evidenceSummary) {
      sets.push("evidence_summary = ?");
      params.push(input.evidenceSummary);
    }
    if (input.sortOrder !== undefined && input.sortOrder !== existingTodo.sortOrder) {
      sets.push("sort_order = ?");
      params.push(input.sortOrder);
    }

    if (sets.length === 0) {
      return { todo: existingTodo, action: "noop" as const };
    }

    sets.push("updated_at = unixepoch() * 1000");
    sets.push("version = version + 1");
    sets.push("updated_by = ?");
    params.push(actor.id ?? null);
    params.push(existing.id);
    params.push(workspaceId);

    const updateSql = `UPDATE todos SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`;

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId,
        featureId: input.featureId,
        workItemId: input.workItemId,
        entityType: "todo",
        entityId: existing.id,
        eventType: "todo.upserted",
        actor,
        source: actor.type,
        payload: { via: "upsert", patch: input },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM todos WHERE id = ?",
      [existing.id],
    );
    if (!row) throw new Error("todo upsert update failed");
    return { todo: mapTodo(row), action: "updated" as const };
  },

  async updateStatus(db, actor, workspaceId, todoId, input) {
    const existing = await todoService.get(db, workspaceId, todoId);
    if (!existing) throw new NotFoundError("todo", todoId);

    // evidence_required gate: marking done needs an evidence_summary.
    if (input.status === "done" && existing.evidenceRequired === 1 && !input.evidenceSummary?.trim()) {
      throw new ValidationError(
        "todo requires an evidence_summary to be marked done (evidence_required=1)",
        { todoId },
      );
    }

    // Don't allow overwriting an already-done todo (phase-02 §4 rule 1 for upsert,
    // applied to status transitions too: once done, it stays done).
    if (existing.status === "done" && input.status !== "done") {
      throw new ConflictError(
        `todo ${todoId} is already done and cannot be reopened (status=${existing.status})`,
        { todoId, status: existing.status },
      );
    }

    // Optimistic concurrency (P02B narrow): if the caller passes expected_version
    // and it doesn't match the current version, the row was modified after the
    // agent loaded context — surface as a conflict. Omitting the field skips the
    // check (backward-compatible with P02A callers).
    if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
      throw new ConflictError(
        `todo ${todoId} version mismatch: expected ${input.expectedVersion}, got ${existing.version}`,
        { todoId, expectedVersion: input.expectedVersion, actualVersion: existing.version },
      );
    }

    // No-op: same status, no version bump, no event.
    if (existing.status === input.status) {
      return existing;
    }

    const completedAt = input.status === "done" ? Date.now() : null;
    const sets = [
      "status = ?",
      "completed_at = ?",
      "updated_at = unixepoch() * 1000",
      "version = version + 1",
      "updated_by = ?",
    ];
    const params: SqlBindValue[] = [input.status, completedAt, actor.id ?? null];

    if (input.evidenceSummary !== undefined) {
      sets.push("evidence_summary = ?");
      params.push(input.evidenceSummary);
    }
    params.push(todoId);
    params.push(workspaceId);

    const updateSql = `UPDATE todos SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`;

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        featureId: existing.featureId ?? undefined,
        workItemId: existing.workItemId ?? undefined,
        entityType: "todo",
        entityId: todoId,
        eventType: "todo.status_changed",
        actor,
        source: actor.type,
        payload: {
          from: existing.status,
          to: input.status,
          evidenceSummary: input.evidenceSummary ?? null,
          agentRunId: input.agentRunId ?? null,
        },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>("SELECT * FROM todos WHERE id = ?", [todoId]);
    if (!row) throw new Error("todo update failed");
    return mapTodo(row);
  },

  async get(db, workspaceId, todoId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM todos WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [todoId, workspaceId],
    );
    return row ? mapTodo(row) : null;
  },

  async listForWorkItem(db, workspaceId, workItemId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM todos WHERE workspace_id = ? AND work_item_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
      [workspaceId, workItemId],
    );
    return rows.map(mapTodo);
  },

  async listForFeature(db, workspaceId, featureId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM todos WHERE workspace_id = ? AND feature_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
      [workspaceId, featureId],
    );
    return rows.map(mapTodo);
  },

  async listForAgentRun(db, workspaceId, agentRunId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM todos WHERE workspace_id = ? AND agent_run_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
      [workspaceId, agentRunId],
    );
    return rows.map(mapTodo);
  },
};
