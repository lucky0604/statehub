import { ok } from "@statehub/shared";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/**
 * GET /api/health
 * Proves the API envelope + DB wiring end-to-end. Actually probes the
 * DB with `SELECT 1` so a misconfigured binding surfaces here instead
 * of in a real request.
 */
export async function GET(): Promise<Response> {
  let dbStatus: "connected" | "disconnected" = "disconnected";
  try {
    await db().first("SELECT 1 AS ok");
    dbStatus = "connected";
  } catch {
    // Swallow — health route should never 500. The status field tells
    // the operator what's wrong; `wrangler tail` has the stack.
  }
  return Response.json(
    ok({
      status: "ok",
      db: dbStatus,
      timestamp: Date.now(),
    }),
  );
}
