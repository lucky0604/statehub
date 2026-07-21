import { notFound } from "next/navigation";

import { requireWorkspace, listProjects, getRecentAgentRuns } from "@/lib/queries";
import { AgentRunTimeline } from "@/components/agent-runs/agent-run-timeline";
import { McpSyncIndicator } from "@/components/mcp-sync/mcp-sync-indicator";
import { getMcpSync } from "@/lib/queries";

/**
 * Agent Runs page — workspace-scoped timeline of every agent run, newest first.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.1
 *
 * Sidebar "Agent Runs" links here. Each row opens the AgentRunDetailDrawer
 * (the timeline client wrapper owns ?run=<id>).
 */
export default async function AgentRunsPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const [runs, projects, sync] = await Promise.all([
    getRecentAgentRuns(wid, 100),
    listProjects(wid),
    getMcpSync(wid),
  ]);

  const projectById = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4 p-4">
      <header className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-[18px] font-semibold text-txt-primary">Agent Runs</h1>
            <p className="mt-0.5 text-[12px] text-txt-secondary">
              Every agent execution in this workspace, newest first.
            </p>
          </div>
          <McpSyncIndicator summary={sync} />
        </div>
      </header>

      {runs.length === 0 ? (
        <div className="rounded-md border border-border-subtle bg-surface-1 p-6 text-center">
          <p className="text-[13px] text-txt-secondary">
            No agent runs yet. Connect an agent via{" "}
            <a
              href={`/workspaces/${wid}/settings/tokens`}
              className="text-accent hover:underline"
            >
              Settings → Tokens
            </a>{" "}
            and follow{" "}
            <a
              href="/docs/mcp/first-sync.md"
              className="text-accent hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              the first-sync walkthrough
            </a>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            // Group runs by project for legibility.
            const byProject = new Map<string, typeof runs>();
            for (const r of runs) {
              const list = byProject.get(r.projectId) ?? [];
              list.push(r);
              byProject.set(r.projectId, list);
            }
            return Array.from(byProject.entries()).map(([projectId, projectRuns]) => {
              const project = projectById.get(projectId);
              return (
                <div key={projectId}>
                  <div className="mb-1.5 flex items-center gap-2 px-1 text-[11px] uppercase tracking-wide text-txt-tertiary">
                    <span className="font-mono-app text-accent">
                      {project?.identifier ?? "?"}
                    </span>
                    <span>{project?.name ?? projectId}</span>
                    <span>· {projectRuns.length} run(s)</span>
                  </div>
                  <AgentRunTimeline workspaceId={wid} runs={projectRuns} />
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
