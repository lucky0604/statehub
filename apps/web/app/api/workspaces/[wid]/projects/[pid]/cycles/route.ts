import { cycleService, type CycleStatus } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  return cycleService.list(db(), wid, pid);
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const body = await parseBody<{
    name?: string;
    status?: CycleStatus;
    startDate?: number;
    endDate?: number;
    sortOrder?: number;
  }>(req);
  return cycleService.create(db(), getActor(), wid, pid, {
    name: required(body.name, "name"),
    status: body.status,
    startDate: body.startDate,
    endDate: body.endDate,
    sortOrder: body.sortOrder,
  });
});
