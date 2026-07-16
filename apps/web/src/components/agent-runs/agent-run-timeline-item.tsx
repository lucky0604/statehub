import type { AgentRun } from "@statehub/domain";
import { cn } from "@/lib/cn";

/**
 * Agent Run timeline item (design system §11.3).
 *
 * One row in the timeline. Click opens the AgentRunDetailDrawer (the parent
 * component wires the onClick — server component can't, so the parent is the
 * client wrapper that owns ?run=<id> URL state).
 *
 * Status visuals:
 *   running: blue pulse dot
 *   completed: green dot
 *   failed: red dot
 *   cancelled: gray dot
 */
interface Props {
  run: AgentRun;
  /** Whether this row is the active one (drawer open). */
  active?: boolean;
  /** Click handler — wired by the client wrapper. */
  onClick?: () => void;
}

const STATUS_DOT: Record<AgentRun["status"], string> = {
  running: "bg-accent animate-pulse",
  completed: "bg-success",
  failed: "bg-danger",
  cancelled: "bg-txt-placeholder",
};

function parseJsonArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function durationLabel(startedAt: number, finishedAt: number | null): string {
  if (!finishedAt) return "running";
  const ms = finishedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

export function AgentRunTimelineItem({ run, active, onClick }: Props) {
  const files = parseJsonArray(run.filesChangedJson);
  const commands = parseJsonArray(run.commandsRunJson);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-md border bg-surface-1 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        active ? "border-accent/50 bg-accent/5" : "border-border-subtle",
      )}
      data-testid={`agent-run-${run.id}`}
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[run.status])} aria-hidden />
        <span className="text-[12px] font-medium text-txt-primary">{run.agent}</span>
        {run.model ? (
          <span className="font-mono-app text-[10px] text-txt-tertiary">{run.model}</span>
        ) : null}
        <span className="rounded-xs bg-layer-2 px-1.5 py-0.5 text-[10px] text-txt-secondary">
          {run.runType}
        </span>
        <span className="ml-auto text-[10px] text-txt-tertiary">
          {durationLabel(run.startedAt, run.finishedAt)}
        </span>
      </div>
      {run.summary ? (
        <p className="mt-1 line-clamp-2 text-[12px] text-txt-secondary">{run.summary}</p>
      ) : (
        <p className="mt-1 text-[12px] text-txt-tertiary italic">No summary yet.</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-txt-tertiary">
        <span className="capitalize">{run.status}</span>
        <span>·</span>
        <span>{files.length} file(s)</span>
        <span>·</span>
        <span>{commands.length} command(s)</span>
        {run.testResult ? (
          <>
            <span>·</span>
            <span className="text-success">{run.testResult}</span>
          </>
        ) : run.status === "completed" ? (
          <>
            <span>·</span>
            <span className="text-warning">no test result</span>
          </>
        ) : null}
        <span>·</span>
        <span>trust: {run.evidenceTrustState.replace("_", " ")}</span>
      </div>
    </button>
  );
}
