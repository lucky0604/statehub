"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { AgentRun } from "@statehub/domain";
import { AgentRunTimelineItem } from "./agent-run-timeline-item";
import { AgentRunDetailDrawer } from "./agent-run-detail-drawer";

/**
 * Client wrapper that owns ?run=<id> URL state for the timeline + drawer.
 *
 * The server renders the timeline (read-only list); this wrapper makes each
 * row clickable and mounts the AgentRunDetailDrawer when ?run=<id> is present.
 * Escape / scrim click removes the param.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.1
 */
interface Props {
  workspaceId: string;
  runs: AgentRun[];
  emptyHint?: string;
}

export function AgentRunTimeline({ workspaceId, runs, emptyHint = "No agent runs yet." }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeRunId = searchParams.get("run");

  function openRun(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("run", id);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  function closeRun() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("run");
    const q = next.toString();
    router.replace(q ? `?${q}` : "?", { scroll: false });
  }

  return (
    <section
      className="rounded-md border border-border-subtle bg-surface-1 p-3"
      aria-label="Agent run timeline"
      data-testid="agent-run-timeline"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Agent runs
        </div>
        <span className="text-[10px] text-txt-tertiary">{runs.length} run(s)</span>
      </div>
      {runs.length === 0 ? (
        <p className="text-[12px] italic text-txt-tertiary">{emptyHint}</p>
      ) : (
        <ul className="space-y-1.5">
          {runs.map((r) => (
            <li key={r.id}>
              <AgentRunTimelineItem
                run={r}
                active={r.id === activeRunId}
                onClick={() => openRun(r.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {activeRunId ? (
        <AgentRunDetailDrawer
          workspaceId={workspaceId}
          runId={activeRunId}
          onClose={closeRun}
        />
      ) : null}
    </section>
  );
}
