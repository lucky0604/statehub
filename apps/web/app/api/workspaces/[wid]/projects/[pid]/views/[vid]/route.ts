import {
  viewService,
  type ViewLayout,
  type ViewQuery,
  type ViewDisplay,
} from "@statehub/domain";
import { withEnvelope, parseBody, param, or404 } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const vid = param(params, "vid");
  return or404(await viewService.get(db(), wid, vid), "view", vid);
});

export const PATCH = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const vid = param(params, "vid");
  const body = await parseBody<{
    name?: string;
    layout?: ViewLayout;
    query?: ViewQuery;
    display?: ViewDisplay;
    sortOrder?: number;
  }>(req);
  return viewService.update(db(), getActor(), wid, vid, body);
});

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const vid = param(params, "vid");
  await viewService.softDelete(db(), getActor(), wid, vid);
  return { id: vid, deleted: true };
});
