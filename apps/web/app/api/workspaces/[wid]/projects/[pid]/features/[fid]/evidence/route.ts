import { evidenceService } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/** Evidence linked to a feature — for the Feature Detail EvidencePanel. */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  return evidenceService.listForFeature(db(), wid, fid);
});
