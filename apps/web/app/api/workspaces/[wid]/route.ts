import { workspaceService } from "@statehub/domain";
import { withEnvelope, parseBody, param, or404 } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  return or404(await workspaceService.get(db(), wid), "workspace", wid);
});

export const PATCH = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const body = await parseBody<{
    name?: string;
    description?: string | null;
  }>(req);
  return workspaceService.update(db(), getActor(), wid, body);
});

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  await workspaceService.softDelete(db(), getActor(), wid);
  return { id: wid, deleted: true };
});
