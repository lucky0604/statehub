import type { McpSyncSummary } from "@statehub/domain";
import { cn } from "@/lib/cn";

/**
 * MCP Sync Indicator — derived state from agent_runs + personal_tokens.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.3
 *         agent_flow/statehub-design-system.md §11.6
 *
 * P02C ships 5 states: syncing / connected / idle / token_error / not_configured.
 * Conflict + offline arrive in P03 (need client polling + optimistic concurrency).
 */
interface Props {
  summary: McpSyncSummary;
}

const STATE_LABELS: Record<McpSyncSummary["state"], string> = {
  syncing: "Syncing",
  connected: "Connected",
  idle: "Idle",
  token_error: "Token error",
  not_configured: "MCP not configured",
};

const STATE_DOT: Record<McpSyncSummary["state"], string> = {
  syncing: "bg-accent animate-pulse",
  connected: "bg-success",
  idle: "bg-txt-tertiary",
  token_error: "bg-warning",
  not_configured: "bg-txt-placeholder",
};

const STATE_TEXT: Record<McpSyncSummary["state"], string> = {
  syncing: "text-accent",
  connected: "text-success",
  idle: "text-txt-tertiary",
  token_error: "text-warning",
  not_configured: "text-txt-tertiary",
};

function relativeFrom(at: number | null): string | null {
  if (!at) return null;
  const ms = Date.now() - at;
  if (ms < 60_000) return "just now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function McpSyncIndicator({ summary }: Props) {
  const last = relativeFrom(summary.lastRunAt);
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-testid="mcp-sync-indicator"
      title={
        summary.lastRunAt
          ? `last run ${new Date(summary.lastRunAt).toLocaleString()}`
          : "no agent runs yet"
      }
    >
      <span
        className={cn("h-2 w-2 rounded-full", STATE_DOT[summary.state])}
        aria-hidden
      />
      <span className={cn("text-[12px]", STATE_TEXT[summary.state])}>
        {STATE_LABELS[summary.state]}
      </span>
      {last ? (
        <span className="text-[11px] text-txt-tertiary">· {last}</span>
      ) : null}
    </span>
  );
}
