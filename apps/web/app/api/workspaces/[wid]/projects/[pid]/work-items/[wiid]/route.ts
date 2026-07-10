import {
  workItemService,
  type WorkItemType,
  type Priority,
  type ConfidenceLevel,
} from "@statehub/domain";
import { withEnvelope, parseBody, param, or404 } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const wiid = param(params, "wiid");
  return or404(await workItemService.get(db(), wid, wiid), "work_item", wiid);
});

export const PATCH = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const wiid = param(params, "wiid");
  const body = await parseBody<{
    title?: string;
    descriptionMarkdown?: string | null;
    featureId?: string | null;
    priority?: Priority;
    type?: WorkItemType;
    confidence?: ConfidenceLevel;
    startDate?: number | null;
    targetDate?: number | null;
    sortOrder?: number;
  }>(req);
  return workItemService.update(db(), getActor(), wid, wiid, body);
});

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const wiid = param(params, "wiid");
  await workItemService.softDelete(db(), getActor(), wid, wiid);
  return { id: wiid, deleted: true };
});
