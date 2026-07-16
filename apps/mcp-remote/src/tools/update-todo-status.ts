/**
 * update_todo_status — flip a todo's status.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4
 *         agent_flow/implementation/v1/iterations/20260716-p02b-agent-write-tools/plan.md §2.3
 *
 * Write tool, scope: write_agent_state. Idempotent on idempotency_key.
 * Rules (phase-02 §4):
 *   - done on evidence_required=1 todo WITHOUT evidence_summary → validation_error
 *   - reopening a 'done' todo → conflict
 *   - same-status transition → noop (no event, no version bump)
 *   - expected_version mismatch (if provided) → conflict
 * dry_run=true returns the would-be action with no DB write.
 */
import { z } from "zod";
import { todoService, type ActorContext, type TodoStatus } from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";
import { withIdempotency } from "../idempotency-guard";

export const updateTodoStatusShape = {
  todo_id: z.string().describe("The todo to update."),
  status: z.enum(["backlog", "in_progress", "done", "cancelled"]).describe("Target status."),
  evidence_summary: z.string().optional().describe("Required if todo.evidence_required=1 AND status='done'."),
  agent_run_id: z.string().optional().describe("Optional agent run to attribute the transition to."),
  expected_version: z.number().optional().describe("Optional optimistic-concurrency check. If provided AND mismatched, returns conflict."),
  idempotency_key: z.string().describe("Client-generated key; replaying returns the first result."),
  dry_run: z.boolean().optional().describe("If true, return the would-be action with no DB write."),
};

export const updateTodoStatusDescription =
  "Flip a todo's status (backlog/in_progress/done/cancelled). done on an evidence_required todo requires evidence_summary. Returns { todo_id, status, version, action }. Write (scope: write_agent_state). Idempotent. Supports dry_run + expected_version.";

export interface UpdateTodoStatusArgs {
  todo_id: string;
  status: TodoStatus;
  evidence_summary?: string;
  agent_run_id?: string;
  expected_version?: number;
  idempotency_key: string;
  dry_run?: boolean;
}

export interface UpdateTodoStatusData {
  todo_id: string;
  status: string;
  version: number;
  action: "updated" | "noop";
}

async function dryRunAction(
  db: DbClient,
  workspaceId: string,
  args: UpdateTodoStatusArgs,
): Promise<ApiResult<UpdateTodoStatusData>> {
  try {
    const row = await db.first<{ id: string; status: string; version: number; evidence_required: number }>(
      "SELECT id, status, version, evidence_required FROM todos WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [args.todo_id, workspaceId],
    );
    if (!row) {
      return {
        ok: false,
        error_code: "not_found",
        message: `todo ${args.todo_id} not found in workspace`,
        retryable: false,
      };
    }
    // evidence_required gate (mirrors the service).
    if (args.status === "done" && row.evidence_required === 1 && !args.evidence_summary?.trim()) {
      return {
        ok: false,
        error_code: "validation_error",
        message: "todo requires an evidence_summary to be marked done (evidence_required=1)",
        retryable: false,
      };
    }
    return {
      ok: true,
      data: {
        todo_id: row.id,
        status: args.status,
        version: row.version,
        action: row.status === args.status ? "noop" : "updated",
      },
    };
  } catch (e) {
    return toToolError(e);
  }
}

export async function updateTodoStatus(
  db: DbClient,
  workspaceId: string,
  actor: ActorContext,
  args: UpdateTodoStatusArgs,
): Promise<ApiResult<UpdateTodoStatusData>> {
  if (args.dry_run) {
    return dryRunAction(db, workspaceId, args);
  }

  const guarded = await withIdempotency<UpdateTodoStatusData>(
    db,
    workspaceId,
    args.idempotency_key,
    "update_todo_status",
    args,
    async () => {
      try {
        const before = await todoService.get(db, workspaceId, args.todo_id);
        if (!before) {
          return {
            ok: false,
            error_code: "not_found",
            message: `todo ${args.todo_id} not found in workspace`,
            retryable: false,
          };
        }
        const updated = await todoService.updateStatus(db, actor, workspaceId, args.todo_id, {
          status: args.status,
          evidenceSummary: args.evidence_summary,
          agentRunId: args.agent_run_id,
          expectedVersion: args.expected_version,
        });
        return {
          ok: true,
          data: {
            todo_id: updated.id,
            status: updated.status,
            version: updated.version,
            action: updated.version === before.version ? "noop" : "updated",
          },
        };
      } catch (e) {
        return toToolError(e);
      }
    },
  );
  return guarded.response;
}
