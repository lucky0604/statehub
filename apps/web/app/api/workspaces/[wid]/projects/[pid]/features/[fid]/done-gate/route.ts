import {
  agentRunService,
  evidenceService,
  todoService,
  featureService,
  doneGateService,
} from "@statehub/domain";
import { withEnvelope, param, or404 } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Done Gate v0 summary for a feature — derived, warning-only. The UI uses this
 * to render the DoneGateWarning panel and a "Ready for review" action.
 *
 * Pure derivation: no writes, no events.
 */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  const feature = or404(await featureService.get(db(), wid, fid), "feature", fid);

  const [agentRuns, evidence, todos] = await Promise.all([
    agentRunService.listForFeature(db(), wid, fid, 50),
    evidenceService.listForFeature(db(), wid, fid),
    todoService.listForFeature(db(), wid, fid),
  ]);

  return doneGateService.summarize({ feature, agentRuns, evidence, todos });
});
