/**
 * MCP sync status — derived from agent_runs + personal_tokens + events.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.3
 *         agent_flow/statehub-design-system.md §11.6
 *
 * P02C derivation (no polling, no SSE — server-component reads at page load):
 *   syncing         — a run with status='running' exists right now
 *   connected       — ≥1 agent_run in last 24h, no running, no token errors
 *   idle            — workspace has tokens but no run in last 24h
 *   token_error     — most recent token was used but produced no successful
 *                     run in the last hour (heuristic for 401/scope_missing)
 *   not_configured  — workspace has zero non-revoked tokens
 *
 * Conflict and offline states arrive in P03+ (need client polling + optimistic
 * concurrency surface). The UI is honest about what we derive.
 */
import type { DbClient } from "@statehub/db";

export type McpSyncState =
  | "syncing"
  | "connected"
  | "idle"
  | "token_error"
  | "not_configured";

export interface McpSyncSummary {
  state: McpSyncState;
  /** Epoch ms of the most recent agent_run, or null if none. */
  lastRunAt: number | null;
  /** Count of runs with status='running' right now. */
  runningCount: number;
  /** Count of non-revoked tokens (for the Settings page hint). */
  activeTokenCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface McpSyncService {
  derive(db: DbClient, workspaceId: string): Promise<McpSyncSummary>;
}

export const mcpSyncService: McpSyncService = {
  async derive(db, workspaceId) {
    const runStats = await db.first<{ running: number; last: number | null }>(
      `SELECT
         SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
         MAX(started_at) AS last
       FROM agent_runs
       WHERE workspace_id = ? AND deleted_at IS NULL`,
      [workspaceId],
    );
    const runningCount = runStats?.running ?? 0;
    const lastRunAt = (runStats?.last ?? null) as number | null;

    const tokenStats = await db.first<{ active: number; last_used: number | null }>(
      `SELECT COUNT(*) AS active, MAX(last_used_at) AS last_used
       FROM personal_tokens
       WHERE workspace_id = ? AND revoked_at IS NULL`,
      [workspaceId],
    );
    const activeTokenCount = tokenStats?.active ?? 0;
    const lastTokenUsedAt = (tokenStats?.last_used ?? null) as number | null;

    if (activeTokenCount === 0) {
      return { state: "not_configured", lastRunAt, runningCount, activeTokenCount };
    }

    if (runningCount > 0) {
      return { state: "syncing", lastRunAt, runningCount, activeTokenCount };
    }

    const now = Date.now();
    const recentRun = lastRunAt !== null && now - lastRunAt < DAY_MS;
    const staleRun = lastRunAt !== null && now - lastRunAt > HOUR_MS;
    const tokenUsedRecently = lastTokenUsedAt !== null && now - lastTokenUsedAt < HOUR_MS;

    // Heuristic: token was used in the last hour but no run succeeded in the
    // last hour → the most recent call was likely a 401 / scope_missing.
    if (tokenUsedRecently && (!lastRunAt || staleRun)) {
      return { state: "token_error", lastRunAt, runningCount, activeTokenCount };
    }

    if (recentRun) {
      return { state: "connected", lastRunAt, runningCount, activeTokenCount };
    }

    return { state: "idle", lastRunAt, runningCount, activeTokenCount };
  },
};
