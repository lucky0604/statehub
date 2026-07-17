import { aiPmService, ValidationError, type AIPmMode } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

const VALID_MODES: AIPmMode[] = [
  "advisor",
  "plan",
  "review_triage",
  "weekly_review",
  "prompt_builder",
];

/**
 * POST /api/workspaces/:wid/ai-pm/query — run the AI PM in one of 5 modes,
 * persist suggested action cards, and return the answer + cards.
 *
 * Body: { mode, project_id?, feature_id?, question? }
 */
export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const body = await parseBody<{
    mode?: string;
    project_id?: string | null;
    feature_id?: string | null;
    question?: string;
  }>(req);
  const mode = required(body.mode, "mode") as AIPmMode;
  if (!VALID_MODES.includes(mode)) {
    throw new ValidationError(`invalid mode: ${mode}`);
  }
  const result = await aiPmService.query(db(), getActor(), wid, {
    mode,
    projectId: body.project_id ?? undefined,
    featureId: body.feature_id ?? undefined,
    question: body.question,
  });
  return {
    query_id: result.queryId,
    answer: result.answer,
    action_cards: result.actionCards,
    provider_name: result.providerName,
  };
});
