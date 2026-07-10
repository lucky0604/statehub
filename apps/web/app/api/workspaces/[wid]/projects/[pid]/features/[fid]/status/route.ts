import { featureService, type FeatureStatus } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  const body = await parseBody<{ status?: FeatureStatus }>(req);
  return featureService.changeStatus(db(), getActor(), wid, fid, required(body.status, "status"));
});
