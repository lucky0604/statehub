import { agentRunService } from "@statehub/domain";
import { withEnvelope, param, or404 } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/** A single agent run + its linked evidence + todos (for the detail drawer). */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const rid = param(params, "rid");
  return or404(await agentRunService.getWithEvidence(db(), wid, rid), "agent_run", rid);
});
