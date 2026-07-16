import { reviewService, NotFoundError } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/:wid/projects/:pid/reviews/:rid — review detail + findings.
 */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const rid = param(params, "rid");
  const review = await reviewService.get(db(), wid, rid);
  if (!review) throw new NotFoundError("review", rid);
  const findings = await reviewService.listFindings(db(), wid, rid);
  return { review, findings };
});
