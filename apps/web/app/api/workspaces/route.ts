import { workspaceService } from "@statehub/domain";
import { withEnvelope, parseBody, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async () => {
  return workspaceService.list(db());
});

export const POST = withEnvelope(async (req) => {
  const body = await parseBody<{
    slug?: string;
    name?: string;
    description?: string;
  }>(req);
  return workspaceService.create(db(), getActor(), {
    slug: required(body.slug, "slug"),
    name: required(body.name, "name"),
    description: body.description,
  });
});
