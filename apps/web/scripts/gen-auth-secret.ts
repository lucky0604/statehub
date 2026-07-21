/**
 * Generate a fresh 32-byte base64 secret for STATEHUB_AUTH_SECRET.
 *
 * Usage:
 *   pnpm --filter @statehub/web run gen:auth-secret
 *
 * Prints a line ready to paste into apps/web/.env.local or hand to
 * `wrangler secret put STATEHUB_AUTH_SECRET`:
 *   STATEHUB_AUTH_SECRET=<base64>
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.11
 */
import { randomBytes } from "node:crypto";

const secret = randomBytes(32).toString("base64");
console.log(`STATEHUB_AUTH_SECRET=${secret}`);
console.log(
  `\nPaste into apps/web/.env.local for dev, or run\n` +
    `  wrangler secret put STATEHUB_AUTH_SECRET\n` +
    `for production. Rotating the secret invalidates all signed sessions —\n` +
    `every user gets logged out and must sign in again.\n`,
);
