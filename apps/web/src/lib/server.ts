/**
 * Server-only DB + actor accessors for API routes.
 *
 * P08A: production deploys to Cloudflare Pages, where the D1 binding
 * comes from `getCloudflareContext().env.DB`. Local dev (`next dev`)
 * and tests keep using better-sqlite3 via `@statehub/db/node`.
 *
 * `db()` stays sync — `getCloudflareContext()` is sync by default
 * (see @opennextjs/cloudflare docs). The result is cached per-module
 * so we don't re-enter AsyncLocalStorage on every request.
 *
 * Safe to import from API routes and server components only —
 * better-sqlite3 is a native binding and won't work in the Edge
 * runtime or client bundle. The production branch never imports
 * `@statehub/db/node`, so the Worker bundle tree-shakes it out.
 */
import { createD1Client, type DbClient } from "@statehub/db";
import { getDb as getDbClient } from "@statehub/db/node";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SOLO_ACTOR, type ActorContext } from "@statehub/domain";

let _db: DbClient | null = null;

export function db(): DbClient {
  if (_db) return _db;
  if (process.env.NODE_ENV === "production") {
    // Sync by default — no `await` needed, no call-site changes.
    // `CloudflareEnv.DB` is augmented in apps/web/types/cloudflare-env.d.ts.
    const { env } = getCloudflareContext();
    _db = createD1Client(env.DB);
  } else {
    _db = getDbClient();
  }
  return _db;
}

export function getActor(): ActorContext {
  return SOLO_ACTOR;
}
