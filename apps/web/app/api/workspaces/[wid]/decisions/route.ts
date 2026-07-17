import { decisionService } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/**
 * POST /api/workspaces/:wid/decisions — record a decision.
 *
 * Body: { project_id?, feature_id?, decision_text, rationale?,
 *         linked_action_id?, linked_weekly_review_id? }
 */
export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const body = await parseBody<{
    project_id?: string | null;
    feature_id?: string | null;
    decision_text?: string;
    rationale?: string;
    linked_action_id?: string;
    linked_weekly_review_id?: string;
  }>(req);
  const decision = await decisionService.record(db(), getActor(), wid, {
    projectId: body.project_id ?? undefined,
    featureId: body.feature_id ?? undefined,
    decisionText: required(body.decision_text, "decision_text"),
    rationale: body.rationale,
    source: "user",
    linkedActionId: body.linked_action_id,
    linkedWeeklyReviewId: body.linked_weekly_review_id,
  });
  return { decision_id: decision.id, decision };
});
