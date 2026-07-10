import { workItemService } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const wiid = param(params, "wiid");
  return { labelIds: await workItemService.listLabelIds(db(), wid, wiid) };
});

/**
 * Replace the work item's label set. Body: { labelIds: string[] }.
 * Assigns the union; removes any labels not in the list.
 */
export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const wiid = param(params, "wiid");
  const body = await parseBody<{ labelIds?: string[] }>(req);
  const labelIds = required(body.labelIds, "labelIds");
  if (!Array.isArray(labelIds)) {
    throw new Error("labelIds must be an array");
  }
  const next = await workItemService.setLabels(db(), getActor(), wid, wiid, labelIds);
  return { labelIds: next };
});
