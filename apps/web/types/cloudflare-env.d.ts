import type { D1Database } from "@cloudflare/workers-types";

/**
 * Augment the global `CloudflareEnv` interface declared by
 * @opennextjs/cloudflare with our D1 binding. The binding name `DB`
 * matches `apps/web/wrangler.toml` and `apps/mcp-remote/wrangler.toml`.
 */
declare global {
  interface CloudflareEnv {
    DB: D1Database;
  }
}

export {};
