/**
 * D1 client accessor.
 *
 * In production (Cloudflare Workers), the D1 binding comes via env.
 * In local dev, wrangler exposes the same binding through Miniflare.
 *
 * P00 ships the accessors; P01A's domain services consume them.
 */
import type { D1Database } from "@cloudflare/workers-types";

let _binding: D1Database | null = null;

/**
 * Register the D1 binding. Called once at app boot from a server-only module.
 * Idempotent — safe to call multiple times.
 */
export function setD1Binding(db: D1Database): void {
  _binding = db;
}

/**
 * Get the registered D1 binding.
 * Throws if setD1Binding was never called — fail loud, not silently.
 */
export function getD1(): D1Database {
  if (_binding === null) {
    throw new Error(
      "D1 binding not registered. Call setD1Binding(env.DB) at app boot.",
    );
  }
  return _binding;
}

/**
 * True if a binding has been registered. Used by /api/health to report
 * "connected" vs "disconnected" without throwing.
 */
export function hasD1(): boolean {
  return _binding !== null;
}
