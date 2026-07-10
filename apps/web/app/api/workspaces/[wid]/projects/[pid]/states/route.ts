import { stateService } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  return stateService.list(db(), wid, pid);
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const body = await parseBody<{
    name?: string;
    statusGroup?: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
    color?: string;
    description?: string;
    sortOrder?: number;
  }>(req);
  return stateService.create(db(), getActor(), wid, pid, {
    name: required(body.name, "name"),
    statusGroup: required(body.statusGroup, "statusGroup"),
    color: body.color,
    description: body.description,
    sortOrder: body.sortOrder,
  });
});
