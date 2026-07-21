/**
 * Auth boundary — verifies the `statehub_session` cookie and injects
 * `x-statehub-user-id` into the request headers for downstream routes.
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.6
 *
 * Why nodejs runtime: we use `node:crypto` (via verifySession) for HMAC.
 * Next.js middleware defaults to the Edge runtime; OpenNext on Cloudflare
 * Workers supports nodejs middleware under nodejs_compat.
 *
 * Auth model:
 * 1. Public paths (login, auth endpoints, health) skip auth.
 * 2. Requests with a Bearer token skip cookie auth — the route does its
 *    own auth (used by the local MCP sidecar's local-evidence endpoint).
 * 3. Cookie-authenticated requests: verify HMAC, inject user-id header.
 * 4. Anything else: 401 for /api/*, redirect to /login for pages.
 */
import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@statehub/domain/auth/session";

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
]);

export const config = {
  matcher: [
    // Match everything except static assets and Next internals.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // Bearer-token requests do their own auth (local MCP sidecar).
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return NextResponse.next();
  }

  const secret = process.env.STATEHUB_AUTH_SECRET;
  if (!secret) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: { code: "auth_not_configured", message: "STATEHUB_AUTH_SECRET is not set" } },
        { status: 500 },
      );
    }
    // For UI requests, redirect to /login to avoid a confusing 500.
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  const token = req.cookies.get("statehub_session")?.value;
  const payload = token ? await verifySession(token, secret) : null;

  if (!payload) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: { code: "unauthenticated", message: "session missing or expired" } },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Inject the user id for downstream route handlers. NextResponse.next
  // with `request.headers` rewrites the incoming request — the route
  // handler sees these headers on `req.headers`.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-statehub-user-id", payload.uid);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
