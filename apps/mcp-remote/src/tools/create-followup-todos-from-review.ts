/**
 * create_followup_todos_from_review — auto-create review_fix work items
 * for blocker/high findings on a review.
 *
 * Source: agent_flow/implementation/v1/phases/phase-03-review-ledger-loop.md §4.2
 *         agent_flow/implementation/v1/iterations/20260716-p03a-review-ledger-foundation/plan.md §2.4
 *
 * Named per the phase-03 contract. Despite the name, v1 creates `review_fix`
 * WORK ITEMS (not todos) for blocker/high findings. Each created work item
 * links back to its finding via finding.linked_work_item_id. Re-running the
 * tool does not duplicate linked fix items.
 *
 * medium findings can be opted-in via `severities: ['medium']`. low/nit
 * are rejected (would pollute project scope — phase-03 §10 risk 2).
 *
 * Write tool, scope: write_agent_state. Idempotent on idempotency_key.
 * dry_run=true returns the would-be-creates with synthetic work_item_ids.
 */
import { z } from "zod";
import {
  reviewService,
  NotFoundError,
  type ActorContext,
  type FindingSeverity,
} from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";
import { withIdempotency } from "../idempotency-guard";

export const createFollowupTodosFromReviewShape = {
  review_id: z.string().describe("The review to generate fix items from."),
  severities: z
    .array(z.enum(["blocker", "high", "medium", "low", "nit"]))
    .optional()
    .describe("Severities to create fix items for. Default ['blocker','high']. 'low' and 'nit' are rejected."),
  idempotency_key: z.string().describe("Client-generated key; replaying returns the first result."),
  agent_run_id: z.string().optional().describe("Optional agent_run_id to attach to events for audit."),
  dry_run: z.boolean().optional().describe("If true, return the would-be-creates with no DB write."),
};

export const createFollowupTodosFromReviewDescription =
  "Create review_fix work items for blocker/high findings on a review (named per phase-03 §4.2 contract — creates work items, not todos). Links each fix back to its finding. Re-running does not duplicate. Write (scope: write_agent_state). Idempotent. Supports dry_run.";

export interface CreateFollowupTodosFromReviewArgs {
  review_id: string;
  severities?: FindingSeverity[];
  idempotency_key: string;
  agent_run_id?: string;
  dry_run?: boolean;
}

export interface CreateFollowupFixData {
  review_id: string;
  created_fixes: Array<{
    work_item_id: string;
    sequence_id: number;
    identifier: string;
    finding_id: string;
    severity: FindingSeverity;
  }>;
  skipped_findings: Array<{
    finding_id: string;
    severity: FindingSeverity;
    reason: "already_linked" | "severity_filtered";
  }>;
  action: "created" | "noop";
}

async function dryRunAction(
  db: DbClient,
  workspaceId: string,
  args: CreateFollowupTodosFromReviewArgs,
): Promise<ApiResult<CreateFollowupFixData>> {
  try {
    const severities = args.severities ?? ["blocker", "high"];
    for (const s of severities) {
      if (s === "low" || s === "nit") {
        return {
          ok: false,
          error_code: "validation_error",
          message: `auto-creating fix items for severity '${s}' is not allowed (would pollute project scope)`,
          retryable: false,
        };
      }
    }

    const review = await reviewService.get(db, workspaceId, args.review_id);
    if (!review) {
      return toToolError(new NotFoundError("review", args.review_id));
    }
    const findings = await reviewService.listFindings(db, workspaceId, args.review_id);

    const createdFixes: CreateFollowupFixData["created_fixes"] = [];
    const skippedFindings: CreateFollowupFixData["skipped_findings"] = [];
    for (const f of findings) {
      if (!severities.includes(f.severity)) {
        skippedFindings.push({ finding_id: f.id, severity: f.severity, reason: "severity_filtered" });
        continue;
      }
      if (f.linkedWorkItemId || f.status === "fixed" || f.status === "dismissed" || f.status === "wontfix") {
        skippedFindings.push({ finding_id: f.id, severity: f.severity, reason: "already_linked" });
        continue;
      }
      createdFixes.push({
        work_item_id: `dry-run-${crypto.randomUUID()}`,
        sequence_id: 0,
        identifier: "dry-run",
        finding_id: f.id,
        severity: f.severity,
      });
    }

    return {
      ok: true,
      data: {
        review_id: args.review_id,
        created_fixes: createdFixes,
        skipped_findings: skippedFindings,
        action: createdFixes.length > 0 ? "created" : "noop",
      },
    };
  } catch (e) {
    return toToolError(e);
  }
}

export async function createFollowupTodosFromReview(
  db: DbClient,
  workspaceId: string,
  actor: ActorContext,
  args: CreateFollowupTodosFromReviewArgs,
): Promise<ApiResult<CreateFollowupFixData>> {
  if (args.dry_run) {
    return dryRunAction(db, workspaceId, args);
  }

  const guarded = await withIdempotency<CreateFollowupFixData>(
    db,
    workspaceId,
    args.idempotency_key,
    "create_followup_todos_from_review",
    args,
    async () => {
      try {
        const result = await reviewService.createFollowupFixes(db, actor, workspaceId, {
          reviewId: args.review_id,
          severities: args.severities,
        });
        return {
          ok: true,
          data: {
            review_id: args.review_id,
            created_fixes: result.createdFixes.map((c) => ({
              work_item_id: c.workItemId,
              sequence_id: c.sequenceId,
              identifier: c.identifier,
              finding_id: c.findingId,
              severity: c.severity,
            })),
            skipped_findings: result.skippedFindings.map((s) => ({
              finding_id: s.findingId,
              severity: s.severity,
              reason: s.reason,
            })),
            action: result.action,
          },
        };
      } catch (e) {
        return toToolError(e);
      }
    },
  );
  return guarded.response;
}
