import { notFound } from "next/navigation";

import {
  requireWorkspace,
  listProjects,
  listStates,
  listIntegrations,
  listImportJobsForWorkspace,
} from "@/lib/queries";
import { ImportWizard } from "@/components/import/import-wizard";

/**
 * GitHub Issues import page — wizard to map GitHub issues to StateHub
 * work items via a configured GitHub integration.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5.2
 */
export default async function ImportPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const [projects, integrations, jobs] = await Promise.all([
    listProjects(wid),
    listIntegrations(wid, { provider: "github" }),
    listImportJobsForWorkspace(wid, { limit: 20 }),
  ]);

  // States for all projects (the wizard filters by selected project).
  const allStates = (
    await Promise.all(projects.map((p) => listStates(wid, p.id)))
  ).flat();

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4 p-4">
      <header className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <h1 className="text-[18px] font-semibold text-txt-primary">Import from GitHub</h1>
        <p className="mt-0.5 text-[12px] text-txt-secondary">
          Map GitHub issues to StateHub work items. Re-running the same import
          is idempotent — issues already linked to a work item are skipped.
        </p>
      </header>

      <ImportWizard
        workspaceId={wid}
        integrations={integrations}
        projects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          identifier: p.identifier,
        }))}
        states={allStates.map((s) => ({
          id: s.id,
          name: s.name,
          projectId: s.projectId,
        }))}
        initialJobs={jobs}
      />
    </div>
  );
}
