/**
 * POST /api/auth/logout — clear the session cookie.
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.13
 *
 * Stateless cookies can't be revoked server-side (no DB row to delete).
 * We just overwrite the cookie with an expired, empty value — the
 * browser drops it, and any stolen cookie value still verifies until
 * its `exp` passes. Rotating STATEHUB_AUTH_SECRET is the only way to
 * invalidate outstanding sessions; that's documented in the plan.
 */
import { ok } from "@statehub/shared";

export const runtime = "nodejs";

const COOKIE_NAME = "statehub_session";

export async function POST(): Promise<Response> {
  const res = Response.json(ok({ ok: true }));
  // Max-Age=0 + same attributes → browser deletes the cookie.
  res.headers.set(
    "set-cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
  return res;
}
