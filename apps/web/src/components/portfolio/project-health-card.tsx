import Link from "next/link";

import type { ProjectHealthSummary } from "@statehub/domain";
import { cn } from "@/lib/cn";

interface Props {
  workspaceId: string;
  projectId: string;
  health: ProjectHealthSummary;
}

/**
 * ProjectHealthSummary card (§4.7, §21.2) — deterministic, derived.
 *
 * Shows current focus, open counts, stale/blocked, missing-next-action, and a
 * suggested next step. Every signal carries a reason. UI copy is "Project Health".
 */
export function ProjectHealthCard({ workspaceId, projectId, health }: Props) {
  const signals = [
    { label: "Open", value: health.openCount, tone: "neutral" as const },
    { label: "In progress", value: health.startedCount, tone: "active" as const },
    {
      label: "Stale",
      value: health.staleCount,
      tone: health.staleCount > 0 ? ("warn" as const) : ("neutral" as const),
      reason: health.staleCount > 0 ? "started items not updated in 7+ days" : undefined,
    },
    {
      label: "Blocked",
      value: health.blockedCount,
      tone: health.blockedCount > 0 ? ("danger" as const) : ("neutral" as const),
      reason: health.blockedCount > 0 ? "items in review" : undefined,
    },
  ];

  return (
    <section
      className="rounded-md border border-border-subtle bg-surface-1 p-4"
      aria-label="Project Health"
      data-testid="project-health"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-txt-primary">Project Health</h2>
        <span className="text-[10px] uppercase tracking-wide text-txt-tertiary">
          derived · deterministic
        </span>
      </div>

      {/* Counts row */}
      <div className="mb-3 grid grid-cols-4 gap-2">
        {signals.map((s) => (
          <div
            key={s.label}
            className="rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1.5"
          >
            <div className="text-[10px] uppercase tracking-wide text-txt-tertiary">
              {s.label}
            </div>
            <div
              className={cn(
                "mt-0.5 text-[16px] font-semibold",
                s.tone === "danger" && "text-danger",
                s.tone === "warn" && "text-warning",
                s.tone === "active" && "text-accent",
                s.tone === "neutral" && "text-txt-primary",
              )}
            >
              {s.value}
            </div>
            {s.reason ? (
              <div className="mt-0.5 text-[10px] text-txt-tertiary">{s.reason}</div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Focus + next action */}
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-txt-tertiary">
            Current focus
          </div>
          {health.currentFocus ? (
            <FocusLink
              workspaceId={workspaceId}
              projectId={projectId}
              focus={health.currentFocus}
            />
          ) : (
            <span className="text-txt-tertiary italic">Nothing in progress</span>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-txt-tertiary">
            Next action
          </div>
          {health.nextAction ? (
            <div>
              <FocusLink
                workspaceId={workspaceId}
                projectId={projectId}
                focus={health.nextAction}
              />
              <div className="mt-0.5 text-[10px] text-txt-tertiary">
                {health.nextAction.reason}
              </div>
            </div>
          ) : health.missingNextAction ? (
            <span className="text-warning italic">
              Nothing queued — decide the next item
            </span>
          ) : (
            <span className="text-txt-tertiary italic">—</span>
          )}
        </div>
      </div>

      {/* Suggested next step */}
      <div className="mt-3 rounded-md bg-accent/5 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-txt-tertiary">
          Suggested next step
        </div>
        <div className="mt-0.5 text-[12px] text-txt-primary">
          {health.suggestedNextStep}
        </div>
      </div>
    </section>
  );
}

function FocusLink({
  workspaceId,
  projectId,
  focus,
}: {
  workspaceId: string;
  projectId: string;
  focus: { workItemId: string; title: string; identifier: string };
}) {
  // If the identifier looks like a work-item id (PROJECT-N), link into the
  // work-items surface with peek; otherwise it's a feature name (no detail route yet).
  const isWorkItem = /-\d+$/.test(focus.identifier);
  const href = isWorkItem
    ? `/workspaces/${workspaceId}/projects/${projectId}?peek=${encodeURIComponent(
        focus.workItemId,
      )}`
    : `/workspaces/${workspaceId}/projects/${projectId}`;
  return (
    <Link href={href} className="font-medium text-txt-primary hover:underline">
      <span className="font-mono-app text-[10px] text-accent">{focus.identifier}</span>{" "}
      {focus.title}
    </Link>
  );
}
