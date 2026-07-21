/**
 * Server-only DB + actor accessors for API routes.
 *
 * P08A: production deploys to Cloudflare Pages, where the D1 binding
 * comes from `getCloudflareContext().env.DB`. Local dev (`next dev`)
 * and tests keep using better-sqlite3 via `@statehub/db/node`.
 *
 * P08B: `getActor()` reads the actor from a per-request `AsyncLocalStorage`
 * populated by `withEnvelope` (which reads `x-statehub-user-id` set by
 * `middleware.ts` after verifying the `statehub_session` cookie). The
 * middleware is the only auth boundary — API routes trust the header.
 *
 * In dev/test where middleware doesn't run (vitest, mcp-remote), the
 * header is absent and we fall back to `SOLO_ACTOR`. Production
 * middleware guarantees the header is present for any non-public path;
 * if it's missing in production we throw `unauthorized` so the route
 * returns 401 instead of silently acting as the solo user.
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
import { AsyncLocalStorage } from "node:async_hooks";
import { createD1Client, type DbClient } from "@statehub/db";
import { getDb as getDbClient } from "@statehub/db/node";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SOLO_ACTOR, DomainError, type ActorContext } from "@statehub/domain";

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

const actorAls = new AsyncLocalStorage<ActorContext>();

/**
 * Resolve the actor for a request. Reads `x-statehub-user-id` set by
 * middleware. In dev/test falls back to SOLO_ACTOR when the header is
 * absent so route handlers can run without a session cookie.
 */
export function actorFromRequest(req: Request): ActorContext {
  const userId = req.headers.get("x-statehub-user-id");
  if (userId) return { type: "user", id: userId, name: "user" };
  if (process.env.NODE_ENV === "production") {
    throw new DomainError(
      "unauthorized",
      "no session — middleware did not set x-statehub-user-id",
    );
  }
  return SOLO_ACTOR;
}

/** Run a handler with an actor bound to the current async context. */
export function runWithActor<T>(actor: ActorContext, fn: () => Promise<T>): Promise<T> {
  return actorAls.run(actor, fn);
}

/**
 * Read the actor for the current request. Sync — works inside any
 * `withEnvelope`-wrapped handler. Returns SOLO_ACTOR in dev/test when
 * no request scope is active.
 */
export function getActor(): ActorContext {
  const actor = actorAls.getStore();
  if (actor) return actor;
  if (process.env.NODE_ENV === "production") {
    throw new DomainError("unauthorized", "getActor() called outside a request scope");
  }
  return SOLO_ACTOR;
}
