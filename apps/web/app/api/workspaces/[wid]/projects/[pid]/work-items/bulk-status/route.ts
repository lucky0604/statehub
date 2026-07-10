import { workItemService } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Bulk status change. Body: { ids: string[], stateId: string }.
 * One event per item (each atomic). Reports updated + skipped ids.
 */
export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const body = await parseBody<{ ids?: string[]; stateId?: string }>(req);
  const ids = required(body.ids, "ids");
  if (!Array.isArray(ids)) throw new Error("ids must be an array");
  const stateId = required(body.stateId, "stateId");
  void pid; // workspace + state validation happens in the service
  return workItemService.bulkChangeStatus(db(), getActor(), wid, ids, stateId);
});
