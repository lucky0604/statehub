import { reviewService } from "@statehub/domain";
import { withEnvelope, param, parseBody, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/**
 * POST /api/workspaces/:wid/projects/:pid/reviews/:rid/findings/:fid/dismiss
 *
 * Body: { reason: string }
 *
 * Dismiss requires a reason (phase-03 §6 "Dismiss requires"). Empty reason
 * returns validation_error.
 */
export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  const body = await parseBody<{ reason?: string }>(req);
  const reason = required(body.reason, "reason");
  return reviewService.dismissFinding(db(), getActor(), wid, fid, reason);
});
