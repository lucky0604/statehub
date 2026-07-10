import { labelService } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  return labelService.list(db(), wid, pid);
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const body = await parseBody<{
    name?: string;
    color?: string;
    sortOrder?: number;
  }>(req);
  return labelService.create(db(), getActor(), wid, pid, {
    name: required(body.name, "name"),
    color: body.color,
    sortOrder: body.sortOrder,
  });
});
