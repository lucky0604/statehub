import { workItemService } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/** Recent events for a work item — feeds the Peek activity section. */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const wiid = param(params, "wiid");
  return workItemService.listEvents(db(), wid, "work_item", wiid);
});
