import { ok } from "@statehub/shared";
import { hasD1 } from "@statehub/db";

export const runtime = "nodejs";

/**
 * GET /api/health
 * Proves the API envelope + DB binding wiring end-to-end.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    ok({
      status: "ok",
      db: hasD1() ? "connected" : "disconnected",
      timestamp: Date.now(),
    }),
  );
}
