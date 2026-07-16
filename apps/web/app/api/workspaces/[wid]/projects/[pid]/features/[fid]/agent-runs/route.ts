import { agentRunService } from "@statehub/domain";
import { withEnvelope, param, query } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/** Agent runs scoped to a single feature — feeds the Feature Detail timeline. */
export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  const q = query(req);
  const limit = q.limit ? Number(q.limit) : 50;
  return agentRunService.listForFeature(db(), wid, fid, limit);
});
