import { err } from "@statehub/shared";

// P08A: was `runtime = "edge"` but OpenNext (Cloudflare Pages adapter)
// requires edge-runtime routes to be split into a separate function.
// This handler is trivial — no edge-only APIs — so nodejs is fine and
// keeps the bundle simple.
export const runtime = "nodejs";

/**
 * Catch-all 404 handler for /api/* routes that don't match.
 * Returns the canonical error envelope so every API failure has the same shape.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    err("not_found", "API endpoint not found.", {
      next_action: "Check the URL or consult the API docs.",
    }),
    { status: 404 },
  );
}

export async function POST(): Promise<Response> {
  return Response.json(
    err("not_found", "API endpoint not found.", {
      next_action: "Check the URL or consult the API docs.",
    }),
    { status: 404 },
  );
}

export async function PATCH(): Promise<Response> {
  return GET();
}

export async function PUT(): Promise<Response> {
  return GET();
}

export async function DELETE(): Promise<Response> {
  return GET();
}
