import Link from "next/link";

import type { AtRiskProject, ProjectHealthSummary } from "@statehub/domain";
import type { Project } from "@statehub/domain";
import { cn } from "@/lib/cn";

interface Props {
  workspaceId: string;
  rows: { project: Project; health: ProjectHealthSummary | null }[];
  atRisk: AtRiskProject[];
}

const PRIORITY_STYLES: Record<string, string> = {
  P0: "bg-danger/15 text-danger",
  P1: "bg-accent/15 text-accent",
  P2: "bg-layer-2 text-txt-secondary",
  Parked: "bg-surface-2 text-txt-tertiary",
};

/**
 * PortfolioProjectTable (§21.1, §4.2).
 *
 * Columns: Project, Type, Priority, Current Feature, Open Work Items,
 * Last Activity, Next Action. Review Findings is a placeholder column
 * (data lands P02/P03).
 */
export function PortfolioTable({ workspaceId, rows, atRisk }: Props) {
  const atRiskIds = new Set(atRisk.map((a) => a.projectId));
  const atRiskReasons = new Map(atRisk.map((a) => [a.projectId, a.reasons.join(", ")]));

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-md border border-border-subtle bg-surface-1">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="border-b border-border-subtle text-left text-[11px] uppercase tracking-wide text-txt-tertiary">
              <Th>Project</Th>
              <Th>Type</Th>
              <Th>Priority</Th>
              <Th>Current Feature</Th>
              <Th className="text-right">Open</Th>
              <Th>Last Activity</Th>
              <Th>Next Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ project, health }) => {
              const atRisk = atRiskIds.has(project.id);
              return (
                <tr
                  key={project.id}
                  className={cn(
                    "border-b border-border-subtle transition-colors hover:bg-surface-2",
                    atRisk && "bg-danger/5",
                  )}
                >
                  <Td>
                    <Link
                      href={`/workspaces/${workspaceId}/projects/${project.id}`}
                      className="block"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono-app text-[11px] text-accent">
                          {project.identifier}
                        </span>
                        <span className="font-medium text-txt-primary">{project.name}</span>
                      </div>
                      {atRisk ? (
                        <span className="mt-0.5 block text-[10px] text-danger">
                          ⚠ {atRiskReasons.get(project.id)}
                        </span>
                      ) : null}
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-txt-secondary">
                      {project.type ? formatEnum(project.type) : "—"}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        "rounded-xs px-1.5 py-0.5 text-[11px] font-medium",
                        PRIORITY_STYLES[project.portfolioPriority] ?? PRIORITY_STYLES.P1,
                      )}
                    >
                      {project.portfolioPriority}
                    </span>
                    <span className="ml-1.5 text-[10px] capitalize text-txt-tertiary">
                      {project.status}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-txt-secondary">
                      {health?.currentFeature ? health.currentFeature.name : "—"}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <span className="font-mono-app text-txt-primary">
                      {health?.openCount ?? 0}
                    </span>
                    {health && health.startedCount > 0 ? (
                      <span className="ml-1 text-[10px] text-accent">
                        {health.startedCount} active
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-txt-tertiary">
                      {health?.lastActivityAt ? formatRelative(health.lastActivityAt) : "—"}
                    </span>
                  </Td>
                  <Td>
                    {health?.nextAction ? (
                      <span className="text-txt-secondary">
                        <span className="font-mono-app text-[10px] text-txt-tertiary">
                          {health.nextAction.identifier}
                        </span>{" "}
                        {health.nextAction.title}
                      </span>
                    ) : (
                      <span className="text-txt-tertiary italic">—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {atRisk.length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-danger">
            Projects at risk
          </div>
          <ul className="mt-1.5 space-y-1">
            {atRisk.map((a) => (
              <li key={a.projectId} className="text-[12px] text-txt-secondary">
                <Link
                  href={`/workspaces/${workspaceId}/projects/${a.projectId}`}
                  className="font-medium text-txt-primary hover:underline"
                >
                  {a.projectName}
                </Link>
                <span className="ml-1.5 text-danger">— {a.reasons.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "border-b border-border-subtle px-3 py-2 font-medium",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2.5 align-top", className)}>{children}</td>;
}

function formatEnum(s: string): string {
  return s.replace(/_/g, " ");
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "1d ago";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  return new Date(ts).toLocaleDateString();
}
