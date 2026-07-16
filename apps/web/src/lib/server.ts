/**
 * Server-only DB + actor accessors for API routes.
 *
 * `getDb()` returns the active DB client (D1 in production, better-sqlite3 in
 * local dev). `getActor()` returns the current actor — for P01A (solo dev, no
 * auth) this is always SOLO_ACTOR. Auth wiring lands in a later phase.
 *
 * Safe to import from API routes and server components only — better-sqlite3
 * is a native binding and won't work in the Edge runtime or client bundle.
 */
import { getDb as getDbClient } from "@statehub/db/node";
import { SOLO_ACTOR, type ActorContext } from "@statehub/domain";

export function db() {
  return getDbClient();
}

export function getActor(): ActorContext {
  return SOLO_ACTOR;
}
