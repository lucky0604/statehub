/**
 * upsert_todos — create-or-merge a todo by fingerprint.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4, §4.0, §4.2
 *         agent_flow/implementation/v1/iterations/20260716-p02b-agent-write-tools/plan.md §2.2
 *
 * Write tool, scope: write_agent_state. Idempotent on idempotency_key.
 * Merge fingerprint: (workspace, project, parent_id, lower(title))
 * where parent_id = work_item_id ?? feature_id ?? agent_run_id ?? NULL.
 * dry_run=true returns the would-be action with no DB write.
 *
 * Work Item-Backed Agent Rule (§4.0): todos are implementation subtasks,
 * checklists, and ephemeral execution notes — NOT scope-affecting tasks.
 * Use upsert_work_items for scope-affecting work.
 */
import { z } from "zod";
import {
  todoService,
  type ActorContext,
  type TodoType,
  type Priority,
} from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";
import { withIdempotency } from "../idempotency-guard";

export const upsertTodosShape = {
  project_id: z.string().describe("Project the todo belongs to (must be in the token's workspace)."),
  title: z.string().describe("Todo title. Used as the merge fingerprint (case-insensitive) alongside project + parent."),
  description: z.string().optional(),
  feature_id: z.string().optional().describe("Optional parent feature."),
  work_item_id: z.string().optional().describe("Optional parent work item."),
  agent_run_id: z.string().optional().describe("Optional parent agent run."),
  type: z.enum(["implementation", "checklist", "verification", "note"]).optional().describe("Default 'implementation'."),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional().describe("Default 'none'."),
  evidence_required: z.boolean().optional().describe("If true, marking done later requires an evidence_summary."),
  sort_order: z.number().optional().describe("Default 0."),
  idempotency_key: z.string().describe("Client-generated key; replaying returns the first result."),
  dry_run: z.boolean().optional().describe("If true, return the would-be action with no DB write."),
};

export const upsertTodosDescription =
  "Create or merge a todo (checklist subtask) by fingerprint (project + parent + title). Returns { todo_id, status, action }. Write (scope: write_agent_state). Idempotent. Supports dry_run.";

export interface UpsertTodosArgs {
  project_id: string;
  title: string;
  description?: string;
  feature_id?: string;
  work_item_id?: string;
  agent_run_id?: string;
  type?: TodoType;
  priority?: Priority;
  evidence_required?: boolean;
  sort_order?: number;
  idempotency_key: string;
  dry_run?: boolean;
}

export interface UpsertTodosData {
  todo_id: string;
  status: string;
  action: "created" | "updated" | "noop";
}

async function dryRunAction(
  db: DbClient,
  workspaceId: string,
  args: UpsertTodosArgs,
): Promise<ApiResult<UpsertTodosData>> {
  try {
    const existing = await db.first<{ id: string; status: string }>(
      `SELECT id, status FROM todos
       WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL
         AND COALESCE(work_item_id, '') = COALESCE(?, '')
         AND COALESCE(feature_id, '') = COALESCE(?, '')
         AND COALESCE(agent_run_id, '') = COALESCE(?, '')
         AND lower(title) = lower(?)`,
      [
        workspaceId,
        args.project_id,
        args.work_item_id ?? null,
        args.feature_id ?? null,
        args.agent_run_id ?? null,
        args.title,
      ],
    );
    if (existing) {
      return {
        ok: true,
        data: { todo_id: existing.id, status: existing.status, action: "updated" },
      };
    }
    return {
      ok: true,
      data: { todo_id: `dry-run-${crypto.randomUUID()}`, status: "backlog", action: "created" },
    };
  } catch (e) {
    return toToolError(e);
  }
}

export async function upsertTodos(
  db: DbClient,
  workspaceId: string,
  actor: ActorContext,
  args: UpsertTodosArgs,
): Promise<ApiResult<UpsertTodosData>> {
  if (args.dry_run) {
    return dryRunAction(db, workspaceId, args);
  }

  const guarded = await withIdempotency<UpsertTodosData>(
    db,
    workspaceId,
    args.idempotency_key,
    "upsert_todos",
    args,
    async () => {
      try {
        const r = await todoService.upsert(db, actor, workspaceId, {
          projectId: args.project_id,
          title: args.title,
          description: args.description,
          featureId: args.feature_id,
          workItemId: args.work_item_id,
          agentRunId: args.agent_run_id,
          type: args.type,
          priority: args.priority,
          evidenceRequired: args.evidence_required ? 1 : 0,
          sortOrder: args.sort_order,
        });
        return {
          ok: true,
          data: { todo_id: r.todo.id, status: r.todo.status, action: r.action },
        };
      } catch (e) {
        return toToolError(e);
      }
    },
  );
  return guarded.response;
}
