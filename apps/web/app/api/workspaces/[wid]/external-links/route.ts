/**
 * GET /api/workspaces/:wid/external-links — list external links.
 * POST /api/workspaces/:wid/external-links — create a new external link.
 *
 * List query params: entity_type?, entity_id?, project_id?
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5
 */
import { externalLinkService, type ExternalSource } from "@statehub/domain";
import { withEnvelope, parseBody, param, query, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const q = query(req);
  const filter: { entityType?: string; entityId?: string; projectId?: string } = {};
  if (q.entity_type) filter.entityType = q.entity_type;
  if (q.entity_id) filter.entityId = q.entity_id;
  if (q.project_id) filter.projectId = q.project_id;
  const links = await externalLinkService.list(db(), wid, filter);
  return { links };
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const body = await parseBody<{
    project_id?: string | null;
    entity_type?: string;
    entity_id?: string;
    external_source?: string;
    external_id?: string;
    external_url?: string;
  }>(req);
  const link = await externalLinkService.create(db(), getActor(), wid, {
    projectId: body.project_id ?? undefined,
    entityType: required(body.entity_type, "entity_type"),
    entityId: required(body.entity_id, "entity_id"),
    externalSource: required(body.external_source, "external_source") as ExternalSource,
    externalId: required(body.external_id, "external_id"),
    externalUrl: required(body.external_url, "external_url"),
  });
  return { link_id: link.id, link };
});
