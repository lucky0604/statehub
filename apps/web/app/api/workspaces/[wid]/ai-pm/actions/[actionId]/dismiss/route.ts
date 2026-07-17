import { actionCardService } from "@statehub/domain";
import { withEnvelope, parseBody, param } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/**
 * POST /api/workspaces/:wid/ai-pm/actions/:actionId/dismiss — dismiss a
 * pending action card. High-risk actions require a reason.
 *
 * Body: { reason? }
 */
export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const actionId = param(params, "actionId");
  const body = await parseBody<{ reason?: string }>(req);
  const card = await actionCardService.dismiss(
    db(),
    getActor(),
    wid,
    actionId,
    body.reason,
  );
  return {
    action_id: card.id,
    status: card.status,
  };
});
