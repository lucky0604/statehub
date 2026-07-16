import { agentRunService } from "@statehub/domain";
import { withEnvelope, param, query } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/**
 * List agent runs in a workspace, optionally filtered by project / feature.
 * Newest first. Used by the Agent Runs page and the right-rail recent section.
 */
export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const q = query(req);
  const limit = q.limit ? Number(q.limit) : 50;

  if (q.featureId) return agentRunService.listForFeature(db(), wid, q.featureId, limit);
  if (q.projectId) return agentRunService.listForProject(db(), wid, q.projectId, limit);
  return agentRunService.listForWorkspace(db(), wid, limit);
});
