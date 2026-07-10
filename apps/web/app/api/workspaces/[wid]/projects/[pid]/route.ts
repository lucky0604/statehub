import {
  projectService,
  type ProjectType,
  type ProjectStatus,
  type PortfolioPriority,
} from "@statehub/domain";
import { withEnvelope, parseBody, param, or404 } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  return or404(await projectService.get(db(), wid, pid), "project", pid);
});

export const PATCH = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const body = await parseBody<{
    name?: string;
    description?: string | null;
    defaultStateId?: string | null;
    defaultAssigneeId?: string | null;
    type?: ProjectType | null;
    status?: ProjectStatus;
    portfolioPriority?: PortfolioPriority;
  }>(req);
  return projectService.update(db(), getActor(), wid, pid, body);
});

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  await projectService.softDelete(db(), getActor(), wid, pid);
  return { id: pid, deleted: true };
});
