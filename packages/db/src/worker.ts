/**
 * Minimal worker entry so wrangler has a `main` to bind against.
 * P00 does not run a real worker — this exists only so `wrangler d1 ... --local`
 * can resolve the config. Replaced at P02 when mcp-remote lands.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response("statehub-db placeholder", { status: 200 });
  },
};
