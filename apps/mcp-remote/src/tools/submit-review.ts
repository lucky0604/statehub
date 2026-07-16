/**
 * submit_review — submit a structured agent review + findings.
 *
 * Source: agent_flow/implementation/v1/phases/phase-03-review-ledger-loop.md §4.1
 *         agent_flow/implementation/v1/iterations/20260716-p03a-review-ledger-foundation/plan.md §2.3
 *
 * Write tool, scope: write_agent_state. Idempotent on idempotency_key.
 * dry_run=true returns the would-be shape with no DB write.
 *
 * Reviews are insert-only in v1 (no update path). Re-submitting with a
 * different idempotency_key creates a new review. The UI shows the latest
 * review by feature.
 *
 * This tool CANNOT mark a feature done. It records the verdict + findings;
 * feature status automation (verdict→needs_changes) ships in P03B.
 */
import { z } from "zod";
import {
  reviewService,
  NotFoundError,
  type ActorContext,
  type ReviewVerdict,
  type FindingSeverity,
  type ConfidenceLevel,
} from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";
import { withIdempotency } from "../idempotency-guard";

const findingShape = {
  severity: z
    .enum(["blocker", "high", "medium", "low", "nit"])
    .describe("Finding severity. blocker/high drive review_fix creation."),
  title: z.string().describe("Short, structured finding title (not markdown)."),
  description: z.string().optional().describe("Longer description / context."),
  file_path: z.string().optional().describe("File path the finding refers to."),
  line_start: z.number().optional().describe("Start line (1-based)."),
  line_end: z.number().optional().describe("End line (1-based)."),
  suggestion: z.string().optional().describe("Suggested fix (code or prose)."),
  feature_id: z.string().optional().describe("Override finding's feature scope."),
  work_item_id: z.string().optional().describe("Override finding's work item scope."),
};

export const submitReviewShape = {
  project_id: z.string().describe("Project the review belongs to (must be in the token's workspace)."),
  feature_id: z.string().optional().describe("Feature under review. At least one of feature/work_item/agent_run recommended."),
  work_item_id: z.string().optional().describe("Work item under review."),
  agent_run_id: z.string().optional().describe("Agent run under review."),
  reviewer: z.string().describe("Reviewer name (e.g. 'codex', 'gpt', 'gemini', or a free-form label)."),
  model: z.string().optional().describe("Model used by the reviewer (e.g. 'gpt-5')."),
  verdict: z
    .enum(["approved", "needs_changes", "blocked", "informational"])
    .describe("Overall review verdict."),
  summary: z.string().optional().describe("Short summary of the review (prose)."),
  confidence: z
    .enum(["high", "medium", "low", "none"])
    .optional()
    .describe("Reviewer confidence. Default 'none'."),
  findings: z
    .array(z.object(findingShape))
    .optional()
    .describe("Structured findings. Default []. Findings must be structured, not markdown-only."),
  idempotency_key: z.string().describe("Client-generated key; replaying returns the first result."),
  agent_run_id_attach: z.string().optional().describe("Optional agent_run_id to attach to events for audit (distinct from the review target)."),
  dry_run: z.boolean().optional().describe("If true, return the would-be shape with no DB write."),
};

export const submitReviewDescription =
  "Submit a structured agent review (verdict + findings) to StateHub. Creates one review row + one row per finding. Returns { review_id, verdict, findings_count, finding_ids, action }. Write (scope: write_agent_state). Idempotent. Supports dry_run. Cannot mark a feature done.";

export interface SubmitReviewArgs {
  project_id: string;
  feature_id?: string;
  work_item_id?: string;
  agent_run_id?: string;
  reviewer: string;
  model?: string;
  verdict: ReviewVerdict;
  summary?: string;
  confidence?: ConfidenceLevel;
  findings?: Array<{
    severity: FindingSeverity;
    title: string;
    description?: string;
    file_path?: string;
    line_start?: number;
    line_end?: number;
    suggestion?: string;
    feature_id?: string;
    work_item_id?: string;
  }>;
  idempotency_key: string;
  agent_run_id_attach?: string;
  dry_run?: boolean;
}

export interface SubmitReviewData {
  review_id: string;
  verdict: ReviewVerdict;
  findings_count: number;
  finding_ids: string[];
  action: "created";
  target_scope: "feature" | "work_item" | "agent_run" | "project";
}

function resolveTargetScope(args: SubmitReviewArgs): SubmitReviewData["target_scope"] {
  if (args.feature_id) return "feature";
  if (args.work_item_id) return "work_item";
  if (args.agent_run_id) return "agent_run";
  return "project";
}

async function dryRunAction(
  db: DbClient,
  workspaceId: string,
  args: SubmitReviewArgs,
): Promise<ApiResult<SubmitReviewData>> {
  try {
    // Validate project exists in workspace so dry-run still catches not_found.
    const project = await db.first<{ id: string }>(
      "SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [args.project_id, workspaceId],
    );
    if (!project) {
      return toToolError(new NotFoundError("project", args.project_id));
    }
    const findingsCount = args.findings?.length ?? 0;
    const findingIds = Array.from({ length: findingsCount }, () => `dry-run-${crypto.randomUUID()}`);
    return {
      ok: true,
      data: {
        review_id: `dry-run-${crypto.randomUUID()}`,
        verdict: args.verdict,
        findings_count: findingsCount,
        finding_ids: findingIds,
        action: "created",
        target_scope: resolveTargetScope(args),
      },
    };
  } catch (e) {
    return toToolError(e);
  }
}

export async function submitReview(
  db: DbClient,
  workspaceId: string,
  actor: ActorContext,
  args: SubmitReviewArgs,
): Promise<ApiResult<SubmitReviewData>> {
  if (args.dry_run) {
    return dryRunAction(db, workspaceId, args);
  }

  const guarded = await withIdempotency<SubmitReviewData>(
    db,
    workspaceId,
    args.idempotency_key,
    "submit_review",
    args,
    async () => {
      try {
        const result = await reviewService.submit(db, actor, workspaceId, {
          projectId: args.project_id,
          featureId: args.feature_id,
          workItemId: args.work_item_id,
          agentRunId: args.agent_run_id,
          reviewer: args.reviewer,
          model: args.model,
          verdict: args.verdict,
          summary: args.summary,
          confidence: args.confidence,
          findings: (args.findings ?? []).map((f) => ({
            severity: f.severity,
            title: f.title,
            description: f.description,
            filePath: f.file_path,
            lineStart: f.line_start,
            lineEnd: f.line_end,
            suggestion: f.suggestion,
            featureId: f.feature_id,
            workItemId: f.work_item_id,
          })),
        });
        return {
          ok: true,
          data: {
            review_id: result.review.id,
            verdict: result.review.verdict,
            findings_count: result.findings.length,
            finding_ids: result.findings.map((f) => f.id),
            action: "created",
            target_scope: resolveTargetScope(args),
          },
        };
      } catch (e) {
        return toToolError(e);
      }
    },
  );
  return guarded.response;
}
