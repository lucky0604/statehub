import { projectService } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  return projectService.list(db(), wid);
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const body = await parseBody<{
    slug?: string;
    name?: string;
    identifier?: string;
    description?: string;
  }>(req);
  return projectService.create(db(), getActor(), wid, {
    slug: required(body.slug, "slug"),
    name: required(body.name, "name"),
    identifier: required(body.identifier, "identifier"),
    description: body.description,
  });
});
