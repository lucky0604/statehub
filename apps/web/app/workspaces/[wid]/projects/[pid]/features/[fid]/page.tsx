import { notFound } from "next/navigation";

import {
  requireWorkspace,
  getProject,
  listFeatures,
  listAgentRunsForFeature,
  listEvidenceForFeature,
  listTodosForFeature,
  getDoneGate,
} from "@/lib/queries";
import { AgentRunTimeline } from "@/components/agent-runs/agent-run-timeline";
import { EvidencePanel } from "@/components/evidence/evidence-panel";
import { TodoChecklist } from "@/components/todos/todo-checklist";
import { DoneGateWarning } from "@/components/done-gate/done-gate-warning";
import { FeatureStatusButton } from "./feature-status-button";

/**
 * Feature Detail page — the surface where an agent's work on a feature becomes
 * visible: timeline, evidence, todos, and the Done Gate v0 warning.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6
 *         agent_flow/implementation/v1/iterations/20260715-p02c-agent-sync-ui-docs/plan.md
 *
 * The project header + Project Health card come from the existing
 * [pid]/layout.tsx; this page is the tab content (replacing the work-items
 * surface when the user navigates into a feature).
 */
export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ wid: string; pid: string; fid: string }>;
}) {
  const { wid, pid, fid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const project = await getProject(wid, pid);
  if (!project) notFound();

  // Verify the feature belongs to this project (defense in depth — the queries
  // already filter by workspace, this just makes the URL honest).
  const features = await listFeatures(wid, pid);
  const feature = features.find((f) => f.id === fid);
  if (!feature) notFound();

  const [runs, evidence, todos, gate] = await Promise.all([
    listAgentRunsForFeature(wid, fid),
    listEvidenceForFeature(wid, fid),
    listTodosForFeature(wid, fid),
    getDoneGate(wid, fid),
  ]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4">
        {/* Header */}
        <header className="rounded-md border border-border-subtle bg-surface-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[12px] text-txt-tertiary">
                <span className="font-mono-app text-accent">{project.identifier}</span>
                <span>/</span>
                <span>Features</span>
              </div>
              <h1 className="mt-0.5 text-[18px] font-semibold text-txt-primary">
                {feature.name}
              </h1>
              {feature.description ? (
                <p className="mt-1 text-[13px] text-txt-secondary">{feature.description}</p>
              ) : null}
              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <span className="rounded-xs bg-layer-2 px-1.5 py-0.5 capitalize text-txt-secondary">
                  {feature.status.replace("_", " ")}
                </span>
                <span className="text-txt-tertiary">
                  created {new Date(feature.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
            <FeatureStatusButton
              workspaceId={wid}
              projectId={pid}
              featureId={fid}
              currentStatus={feature.status}
              readyForReview={gate.readyForReview}
            />
          </div>
        </header>

        {/* Done Gate */}
        <DoneGateWarning summary={gate} />

        {/* Two-column layout: timeline + (evidence + todos) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AgentRunTimeline workspaceId={wid} runs={runs} />
          <div className="flex flex-col gap-4">
            <EvidencePanel evidence={evidence} />
            <TodoChecklist todos={todos} />
          </div>
        </div>
      </div>
    </div>
  );
}
