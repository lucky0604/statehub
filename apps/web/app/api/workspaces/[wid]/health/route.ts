import { projectHealthService } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Portfolio-level health: per-project deterministic summaries + at-risk list +
 * open high-priority count. Read-only, no provider.
 */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  return projectHealthService.portfolio(db(), wid);
});
