/**
 * Delete a single repo alias.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §5
 */
import { repoAliasService } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const aliasId = param(params, "aliasId");
  await repoAliasService.remove(db(), getActor(), wid, pid, aliasId);
  return { id: aliasId, deleted: true };
});
