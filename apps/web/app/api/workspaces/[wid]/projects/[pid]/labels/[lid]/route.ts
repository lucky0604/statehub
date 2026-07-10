import { labelService } from "@statehub/domain";
import { withEnvelope, parseBody, param } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const PATCH = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const lid = param(params, "lid");
  const body = await parseBody<{
    name?: string;
    color?: string | null;
    sortOrder?: number;
  }>(req);
  return labelService.update(db(), getActor(), wid, lid, body);
});

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const lid = param(params, "lid");
  await labelService.softDelete(db(), getActor(), wid, lid);
  return { id: lid, deleted: true };
});
