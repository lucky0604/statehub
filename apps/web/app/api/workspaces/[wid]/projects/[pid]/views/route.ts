import {
  viewService,
  type ViewLayout,
  type ViewQuery,
  type ViewDisplay,
} from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  return viewService.list(db(), wid, pid);
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const body = await parseBody<{
    name?: string;
    layout?: ViewLayout;
    query?: ViewQuery;
    display?: ViewDisplay;
    sortOrder?: number;
  }>(req);
  return viewService.create(db(), getActor(), wid, pid, {
    name: required(body.name, "name"),
    layout: body.layout,
    query: body.query ?? {},
    display: body.display,
    sortOrder: body.sortOrder,
  });
});
