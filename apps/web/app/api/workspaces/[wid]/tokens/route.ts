import { tokenService, type TokenScope } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/** List non-revoked tokens (prefix only — raw token is never stored). */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  return tokenService.list(db(), wid);
});

/**
 * Issue a new personal token. The raw token is returned ONCE in `token`; the
 * UI must display it in a one-time banner and never re-fetch it.
 */
export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const body = await parseBody<{ name?: string; scopes?: TokenScope[] }>(req);
  const scopes = body.scopes ?? ["read"];
  return tokenService.issue(db(), wid, {
    name: required(body.name, "name"),
    scopes,
    createdBy: getActor().id,
  });
});
