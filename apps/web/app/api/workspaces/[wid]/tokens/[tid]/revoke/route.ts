import { tokenService } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/** Revoke a personal token. The token can no longer authenticate after this. */
export const POST = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const tid = param(params, "tid");
  await tokenService.revoke(db(), wid, tid);
  return { id: tid, revoked: true, actor: getActor().id };
});
