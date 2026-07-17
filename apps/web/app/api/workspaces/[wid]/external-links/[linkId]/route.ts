/**
 * DELETE /api/workspaces/:wid/external-links/:linkId — remove an external link.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5
 */
import { externalLinkService } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const linkId = param(params, "linkId");
  await externalLinkService.remove(db(), getActor(), wid, linkId);
  return { id: linkId, deleted: true };
});
