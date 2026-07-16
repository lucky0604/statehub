import {
  agentRunService,
  evidenceService,
  todoService,
  featureService,
  reviewService,
  doneGateService,
} from "@statehub/domain";
import { withEnvelope, param, or404 } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Done Gate v1 summary for a feature — review-aware (phase-03 §6). Returns
 * `result: 'pass' | 'warn' | 'blocked'` plus a structured checklist. The UI
 * uses this to render the DoneGate panel and a "Ready for review" action.
 *
 * Pure derivation: no writes, no events. Assembles reviews + findings +
 * agent runs + evidence + todos for the feature and runs the pure
 * doneGateService.summarize.
 */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  const feature = or404(await featureService.get(db(), wid, fid), "feature", fid);

  const [agentRuns, evidence, todos, reviews] = await Promise.all([
    agentRunService.listForFeature(db(), wid, fid, 50),
    evidenceService.listForFeature(db(), wid, fid),
    todoService.listForFeature(db(), wid, fid),
    reviewService.listForFeature(db(), wid, fid, 50),
  ]);

  // Gather findings across all reviews on this feature.
  const findings: Awaited<ReturnType<typeof reviewService.listFindings>> = [];
  for (const r of reviews) {
    const f = await reviewService.listFindings(db(), wid, r.id);
    findings.push(...f);
  }

  return doneGateService.summarize({
    feature,
    agentRuns,
    evidence,
    todos,
    reviews,
    findings,
  });
});
