import { featureService } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  return featureService.list(db(), wid, pid);
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const body = await parseBody<{
    name?: string;
    description?: string;
    status?: "backlog" | "planned" | "in_progress" | "needs_review" | "needs_changes" | "done" | "reopened";
    sortOrder?: number;
  }>(req);
  return featureService.create(db(), getActor(), wid, pid, {
    name: required(body.name, "name"),
    description: body.description,
    status: body.status,
    sortOrder: body.sortOrder,
  });
});
