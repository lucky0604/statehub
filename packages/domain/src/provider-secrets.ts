/**
 * Per-provider list of config keys that hold provider tokens. Used by:
 *   - `services/integration.ts` — encrypt on write, decrypt on read.
 *   - `mappers.ts` — mask in GET responses.
 *   - event payload `stripSecrets`.
 *
 * Kept here (not in `packages/integrations`) to avoid a domain →
 * integrations dependency. The coupling is already implicit: the
 * provider clients expect these exact keys in the config they receive.
 *
 * Source: agent_flow/implementation/v1/iterations/20260718-p07d-token-encryption/plan.md §3.2
 */
import type { IntegrationProvider } from "@statehub/db";

export const SECRET_FIELDS: Record<IntegrationProvider, string[]> = {
  github: ["pat"],
  plane: ["api_token"],
  linear: ["api_key"],
  markdown: [],
};
