/**
 * Generate a fresh 32-byte base64 key for STATEHUB_INTEGRATION_KEY.
 *
 * Usage:
 *   pnpm --filter @statehub/web run gen:integration-key
 *
 * Prints a line ready to paste into apps/web/.env.local:
 *   STATEHUB_INTEGRATION_KEY=<base64>
 *
 * Source: agent_flow/implementation/v1/iterations/20260718-p07d-token-encryption/plan.md §3.5
 */
import { generateKeyB64 } from "@statehub/domain";

const key = generateKeyB64();
console.log(`STATEHUB_INTEGRATION_KEY=${key}`);
console.log(
  `\nPaste this into apps/web/.env.local. Keep it secret — losing it means\n` +
    `existing encrypted tokens become unrecoverable (you'll need to re-enter them).\n`,
);
