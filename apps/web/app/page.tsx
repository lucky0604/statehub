import { requireWorkspace, listProjects, getPortfolioHealth } from "@/lib/queries";
import { PORTFOLIO_PRIORITY_RANK } from "@statehub/domain";
import type { PortfolioHealth, Project } from "@statehub/domain";
import { PortfolioTable } from "@/components/portfolio/portfolio-table";

/**
 * Portfolio dashboard — the home page (§21.1).
 *
 * Answers "what should I work on this week?" with a project priority table plus
 * a deterministic health rollup. Every health signal carries a reason.
 *
 * UI copy is "Project Health" — never "AI PM" (reserved for P05).
 */
export default async function HomePage() {
  let ws;
  try {
    ws = await requireWorkspace();
  } catch {
    return <EmptyWorkspace />;
  }

  const [projects, health] = await Promise.all([
    listProjects(ws.id),
    getPortfolioHealth(ws.id),
  ]);

  // Index health + features by project id for the table.
  const healthById = new Map(health.byProject.map((h) => [h.projectId, h]));

  // Sort by portfolio priority (P0 first), then name.
  const sorted = [...projects].sort((a, b) => {
    const pr =
      (PORTFOLIO_PRIORITY_RANK[a.portfolioPriority] ?? 9) -
      (PORTFOLIO_PRIORITY_RANK[b.portfolioPriority] ?? 9);
    if (pr !== 0) return pr;
    return a.name.localeCompare(b.name);
  });

  const rows: PortfolioRow[] = sorted.map((p) => {
    const h = healthById.get(p.id);
    return {
      project: p,
      health: h ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl py-6">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-txt-primary">{ws.name}</h1>
        <p className="mt-0.5 text-[13px] text-txt-secondary">
          {projects.length} project{projects.length === 1 ? "" : "s"} ·{" "}
          <span className="text-danger">{health.atRisk.length} at risk</span> ·{" "}
          <span className="text-txt-tertiary">{health.openHigh} open high</span>
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-md border border-border-subtle bg-surface-1 p-8 text-center">
          <p className="text-[13px] text-txt-secondary">No projects yet.</p>
          <p className="mt-1 text-[12px] text-txt-tertiary">
            Run <code className="font-mono-app">pnpm db:seed</code> to create a
            sample project, or create one via the API.
          </p>
        </div>
      ) : (
        <PortfolioTable workspaceId={ws.id} rows={rows} atRisk={health.atRisk} />
      )}
    </div>
  );
}

export interface PortfolioRow {
  project: Project;
  health: PortfolioHealth["byProject"][number] | null;
}

function EmptyWorkspace() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="text-[20px] font-semibold text-txt-primary">StateHub</h1>
      <p className="mt-1 text-[13px] text-txt-secondary">
        AI-native project manager for solo builders.
      </p>
      <div className="mt-8 rounded-md border border-border-subtle bg-surface-1 p-6">
        <h2 className="text-[15px] font-semibold text-txt-primary">
          Welcome — let&apos;s set up your workspace
        </h2>
        <p className="mt-1 text-[13px] text-txt-tertiary">
          No workspace exists yet. Run{" "}
          <code className="font-mono-app">pnpm db:seed</code> from the repo root
          to create a solo workspace with a sample project.
        </p>
      </div>
    </div>
  );
}
