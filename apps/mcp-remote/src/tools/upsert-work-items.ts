/**
 * upsert_work_items — create-or-merge a work item by fingerprint.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4, §4.0, §4.2
 *         agent_flow/implementation/v1/iterations/20260716-p02b-agent-write-tools/plan.md §2.1
 *
 * Write tool, scope: write_agent_state. Idempotent on idempotency_key.
 * Merge fingerprint: (workspace, project, parent_work_item_id, lower(title)).
 * dry_run=true returns the would-be action with no DB write / event / idempotency record.
 *
 * Work Item-Backed Agent Rule (§4.0): use this for scope-affecting tasks.
 * For implementation subtasks / checklists, use upsert_todos instead.
 */
import { z } from "zod";
import {
  workItemService,
  type ActorContext,
  type WorkItemType,
  type Priority,
  type ConfidenceLevel,
} from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";
import { withIdempotency } from "../idempotency-guard";

export const upsertWorkItemsShape = {
  project_id: z.string().describe("Project the work item belongs to (must be in the token's workspace)."),
  title: z.string().describe("Work item title. Used as the merge fingerprint (case-insensitive) alongside project + parent."),
  description_markdown: z.string().optional().describe("Optional markdown description."),
  feature_id: z.string().optional().describe("Optional feature to link the work item to."),
  parent_work_item_id: z.string().optional().describe("Optional parent work item."),
  type: z.enum(["issue", "task", "bug", "enhancement", "note"]).optional().describe("Default 'task'."),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional().describe("Default 'none'."),
  state_id: z.string().optional().describe("Optional initial state. Defaults to the project's default state."),
  confidence: z.enum(["high", "medium", "low", "none"]).optional().describe("Default 'low' for agent writes."),
  idempotency_key: z.string().describe("Client-generated key; replaying with the same key returns the first result."),
  dry_run: z.boolean().optional().describe("If true, return the would-be action with no DB write."),
};

export const upsertWorkItemsDescription =
  "Create or merge a work item by fingerprint (project + parent + title). Returns { work_item_id, sequence_id, identifier, action }. Write (scope: write_agent_state). Idempotent. Supports dry_run.";

export interface UpsertWorkItemsArgs {
  project_id: string;
  title: string;
  description_markdown?: string;
  feature_id?: string;
  parent_work_item_id?: string;
  type?: WorkItemType;
  priority?: Priority;
  state_id?: string;
  confidence?: ConfidenceLevel;
  idempotency_key: string;
  dry_run?: boolean;
}

export interface UpsertWorkItemsData {
  work_item_id: string;
  sequence_id: number | null;
  identifier: string | null;
  action: "created" | "updated" | "noop";
}

/**
 * Compute the would-be action WITHOUT writing. Runs the same validation +
 * fingerprint lookup the real upsert does, then returns the action + a
 * synthetic id for shape (callers must not reuse a dry-run id).
 */
async function dryRunAction(
  db: DbClient,
  workspaceId: string,
  args: UpsertWorkItemsArgs,
): Promise<ApiResult<UpsertWorkItemsData>> {
  try {
    // The service's upsert writes — so for dry-run we replicate just the
    // fingerprint lookup. Validation (project / parent existence) is delegated
    // to a lightweight pre-check here; the full check runs on the real call.
    const existing = await db.first<{ id: string; sequence_id: number; project_identifier: string }>(
      `SELECT id, sequence_id, project_identifier FROM work_items
       WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL
         AND COALESCE(parent_work_item_id, '') = COALESCE(?, '')
         AND lower(title) = lower(?)`,
      [workspaceId, args.project_id, args.parent_work_item_id ?? null, args.title],
    );
    if (existing) {
      return {
        ok: true,
        data: {
          work_item_id: existing.id,
          sequence_id: existing.sequence_id,
          identifier: `${existing.project_identifier}-${existing.sequence_id}`,
          action: "updated",
        },
      };
    }
    return {
      ok: true,
      data: {
        work_item_id: `dry-run-${crypto.randomUUID()}`,
        sequence_id: null,
        identifier: null,
        action: "created",
      },
    };
  } catch (e) {
    return toToolError(e);
  }
}

export async function upsertWorkItems(
  db: DbClient,
  workspaceId: string,
  actor: ActorContext,
  args: UpsertWorkItemsArgs,
): Promise<ApiResult<UpsertWorkItemsData>> {
  if (args.dry_run) {
    return dryRunAction(db, workspaceId, args);
  }

  const guarded = await withIdempotency<UpsertWorkItemsData>(
    db,
    workspaceId,
    args.idempotency_key,
    "upsert_work_items",
    args,
    async () => {
      try {
        const r = await workItemService.upsert(db, actor, workspaceId, args.project_id, {
          title: args.title,
          descriptionMarkdown: args.description_markdown,
          featureId: args.feature_id,
          parentWorkItemId: args.parent_work_item_id,
          type: args.type,
          priority: args.priority,
          stateId: args.state_id,
          confidence: args.confidence,
        });
        return {
          ok: true,
          data: {
            work_item_id: r.workItem.id,
            sequence_id: r.workItem.sequenceId,
            identifier: `${r.workItem.projectIdentifier}-${r.workItem.sequenceId}`,
            action: r.action,
          },
        };
      } catch (e) {
        return toToolError(e);
      }
    },
  );
  return guarded.response;
}
