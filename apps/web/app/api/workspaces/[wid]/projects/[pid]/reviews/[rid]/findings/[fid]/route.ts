import { reviewService, type FindingStatus } from "@statehub/domain";
import { withEnvelope, param, parseBody, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/**
 * PATCH /api/workspaces/:wid/projects/:pid/reviews/:rid/findings/:fid
 *
 * Body: { to_status: 'accepted'|'fixed'|'reopened', dismissed_reason?: string }
 *
 * Enforces the phase-03 §6 finding state machine. For dismiss, use the
 * dedicated /dismiss endpoint which requires a reason.
 */
export const PATCH = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  const body = await parseBody<{
    to_status?: FindingStatus;
    dismissed_reason?: string;
  }>(req);
  const toStatus = required(body.to_status, "to_status") as FindingStatus;
  return reviewService.transitionFinding(db(), getActor(), wid, fid, {
    toStatus,
    dismissedReason: body.dismissed_reason,
  });
});
