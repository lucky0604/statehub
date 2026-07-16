import { cn } from "../lib/cn";
import {
  requireWorkspace,
  getPortfolioHealth,
  getRecentAgentRuns,
} from "@/lib/queries";
import Link from "next/link";
import type { AgentRun } from "@statehub/domain";

/**
 * RightRail — 336px context panel (§9.4).
 *
 * P01C: shows the portfolio-level deterministic health rollup (at-risk
 * projects, open high-priority work). Context-specific project/work-item
 * sections arrive as the routes land; the portfolio rollup is the baseline.
 *
 * Read-only. UI copy is "Project Health" — never "AI PM" (reserved for P05).
 */
export async function RightRail({ className }: { className?: string }) {
  let ws;
  let health;
  let recentRuns: AgentRun[] = [];
  try {
    ws = await requireWorkspace();
    [health, recentRuns] = await Promise.all([
      getPortfolioHealth(ws.id),
      getRecentAgentRuns(ws.id, 3),
    ]);
  } catch {
    // No workspace yet (fresh install) — render empty placeholders.
    return <RailShell className={className} />;
  }

  return (
    <RailShell className={className}>
      <section className="rounded-md border border-border-subtle bg-surface-2 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Project Health
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px]">
          <span className="text-txt-secondary">Open high priority</span>
          <span className="font-mono-app font-semibold text-danger">{health.openHigh}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[12px]">
          <span className="text-txt-secondary">Projects at risk</span>
          <span className="font-mono-app font-semibold text-warning">
            {health.atRisk.length}
          </span>
        </div>
      </section>

      <section className="rounded-md border border-border-subtle bg-surface-2 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          At risk
        </div>
        {health.atRisk.length === 0 ? (
          <div className="mt-1.5 text-[12px] text-txt-tertiary italic">
            No projects flagged.
          </div>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {health.atRisk.slice(0, 6).map((a) => (
              <li key={a.projectId} className="text-[12px]">
                <Link
                  href={`/workspaces/${ws!.id}/projects/${a.projectId}`}
                  className="font-medium text-txt-primary hover:underline"
                >
                  {a.projectName}
                </Link>
                <div className="text-[10px] text-danger">{a.reasons.join(", ")}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-border-subtle bg-surface-2 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Next Action
        </div>
        <div className="mt-1.5 text-[12px] text-txt-tertiary italic">
          Per-project next actions are in the portfolio table.
        </div>
      </section>

      <section className="rounded-md border border-border-subtle bg-surface-2 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Risks
        </div>
        <div className="mt-1 text-[12px] text-txt-placeholder">lands P03</div>
      </section>

      <section className="rounded-md border border-border-subtle bg-surface-2 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Recent Agent Runs
        </div>
        {recentRuns.length === 0 ? (
          <div className="mt-1.5 text-[12px] text-txt-tertiary italic">
            No agent runs yet.
          </div>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {recentRuns.map((r) => (
              <li key={r.id} className="text-[12px]">
                <Link
                  href={`/workspaces/${ws!.id}/agent-runs?run=${r.id}`}
                  className="font-medium text-txt-primary hover:underline"
                >
                  {r.summary || `${r.agent} · ${r.id.slice(0, 8)}`}
                </Link>
                <div className="text-[10px] text-txt-tertiary">
                  {new Date(r.startedAt).toLocaleString()} · {r.status}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RailShell>
  );
}

function RailShell({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <aside
      className={cn(
        "hidden w-[var(--right-rail-width)] shrink-0 flex-col gap-3 border-l border-border-subtle bg-surface-1 p-3 lg:flex",
        className,
      )}
      aria-label="Context rail"
      data-testid="right-rail"
    >
      {children}
    </aside>
  );
}
