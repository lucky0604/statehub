import { featureService } from "@statehub/domain";
import { withEnvelope, parseBody, param, or404 } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  return or404(await featureService.get(db(), wid, fid), "feature", fid);
});

export const PATCH = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  const body = await parseBody<{
    name?: string;
    description?: string | null;
    sortOrder?: number;
  }>(req);
  return featureService.update(db(), getActor(), wid, fid, body);
});

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  await featureService.softDelete(db(), getActor(), wid, fid);
  return { id: fid, deleted: true };
});
