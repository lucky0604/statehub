import { workItemService } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const wiid = param(params, "wiid");
  const body = await parseBody<{ stateId?: string }>(req);
  return workItemService.changeStatus(db(), getActor(), wid, wiid, required(body.stateId, "stateId"));
});
