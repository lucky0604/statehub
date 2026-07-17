import { actionCardService } from "@statehub/domain";
import { withEnvelope, parseBody, param } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/**
 * POST /api/workspaces/:wid/ai-pm/actions/:actionId/apply — apply a pending
 * action card. Re-validates against current DB state, executes the underlying
 * domain write, and flips the card to status=applied.
 *
 * Body: { edited_payload?, confirm_high_risk? }
 *
 * Safety:
 *   - high-risk actions require confirm_high_risk=true (else 422
 *     high_risk_confirmation_required)
 *   - mark_feature_done runs the Done Gate (else 422 done_gate_blocked)
 *   - already-applied/dismissed cards return 409 conflict
 */
export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const actionId = param(params, "actionId");
  const body = await parseBody<{
    edited_payload?: unknown;
    confirm_high_risk?: boolean;
  }>(req);
  const { card, result } = await actionCardService.apply(
    db(),
    getActor(),
    wid,
    actionId,
    {
      editedPayload: body.edited_payload,
      confirmHighRisk: body.confirm_high_risk === true,
    },
  );
  return {
    action_id: card.id,
    status: card.status,
    result,
  };
});
