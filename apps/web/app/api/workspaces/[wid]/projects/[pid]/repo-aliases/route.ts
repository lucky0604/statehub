/**
 * Repo aliases for a project — list/add/remove.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §5
 *         agent_flow/implementation/v1/iterations/20260716-p04a-remote-repo-identity/plan.md §2.2
 *
 * Aliases are normalized on insert. The (workspace_id, alias_url) UNIQUE
 * constraint means a given remote URL can only be attached to one project
 * in a workspace.
 */
import { repoAliasService } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  return repoAliasService.list(db(), wid, pid);
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const body = await parseBody<{ alias_url?: string }>(req);
  const aliasUrl = required(body.alias_url, "alias_url");
  return repoAliasService.add(db(), getActor(), wid, pid, aliasUrl);
});
