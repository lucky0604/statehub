import { stateService } from "@statehub/domain";
import { withEnvelope, parseBody, param } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const PATCH = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const sid = param(params, "sid");
  const body = await parseBody<{
    name?: string;
    color?: string | null;
    description?: string | null;
    sortOrder?: number;
  }>(req);
  return stateService.update(db(), getActor(), wid, sid, body);
});

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const sid = param(params, "sid");
  await stateService.softDelete(db(), getActor(), wid, sid);
  return { id: sid, deleted: true };
});
