import { reviewService, type ReviewVerdict } from "@statehub/domain";
import { withEnvelope, param, query } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/:wid/projects/:pid/reviews — list reviews.
 *
 * Query params: feature_id?, verdict?, limit?
 */
export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const q = query(req);
  return reviewService.list(db(), wid, {
    projectId: pid,
    featureId: q.feature_id,
    verdict: q.verdict as ReviewVerdict | undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  });
});
