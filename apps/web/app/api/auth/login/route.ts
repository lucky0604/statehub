/**
 * POST /api/auth/login — verify credentials, set session cookie.
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.9
 *
 * Body: { email, password }
 * 200: { ok: true, data: { user: { id, email, name } } } + Set-Cookie
 * 400: missing fields
 * 401: invalid credentials
 *
 * Cookie attributes:
 *   HttpOnly — not readable from JS
 *   Secure   — only set in production (HTTPS). Dev is HTTP; setting
 *              Secure would cause the browser to drop the cookie.
 *   SameSite=Lax — allow top-level navigations to carry the cookie
 *   Path=/         — apply to the whole app
 *   Max-Age=86400 — 24h, matches the session token TTL
 */
import { authService } from "@statehub/domain";
import { ok, err } from "@statehub/shared";
import { db } from "@/lib/server";

export const runtime = "nodejs";

const COOKIE_NAME = "statehub_session";
const COOKIE_TTL_SECONDS = 24 * 60 * 60;

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as LoginBody;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return Response.json(err("validation_error", "email and password are required"), {
      status: 400,
    });
  }

  const secret = process.env.STATEHUB_AUTH_SECRET;
  if (!secret) {
    return Response.json(err("internal_error", "STATEHUB_AUTH_SECRET is not configured"), {
      status: 500,
    });
  }

  const result = await authService.login(db(), email, password, secret);
  if (!result) {
    return Response.json(err("unauthorized", "Invalid email or password"), { status: 401 });
  }

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = [
    `${COOKIE_NAME}=${result.token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${COOKIE_TTL_SECONDS}`,
    secure,
  ]
    .filter(Boolean)
    .join("; ");

  const res = Response.json(
    ok({
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
    }),
  );
  res.headers.set("set-cookie", cookie);
  return res;
}
