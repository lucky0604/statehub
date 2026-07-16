import { mcpSyncService } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Derived MCP sync status — no polling, no SSE. Read at page load by the
 * TopBar indicator. State is derived from agent_runs + personal_tokens.
 */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  return mcpSyncService.derive(db(), wid);
});
