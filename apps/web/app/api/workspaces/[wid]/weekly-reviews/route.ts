import { weeklyReviewService } from "@statehub/domain";
import { withEnvelope, parseBody, param, query, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/:wid/weekly-reviews — list weekly reviews.
 * Query params: project_id? (omit for workspace-level reviews)
 */
export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const q = query(req);
  const filter =
    q.project_id !== undefined
      ? { projectId: q.project_id === "" ? null : q.project_id }
      : undefined;
  return { reviews: await weeklyReviewService.list(db(), wid, filter) };
});

/**
 * POST /api/workspaces/:wid/weekly-reviews — save a weekly review.
 * Body: { project_id?, week_start, week_end, summary_json }
 */
export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const body = await parseBody<{
    project_id?: string | null;
    week_start?: number;
    week_end?: number;
    summary_json?: string;
  }>(req);
  const review = await weeklyReviewService.save(db(), getActor(), wid, {
    projectId: body.project_id ?? null,
    weekStart: required(body.week_start, "week_start"),
    weekEnd: required(body.week_end, "week_end"),
    summaryJson: required(body.summary_json, "summary_json"),
  });
  return { review_id: review.id, review };
});
