import { notFound } from "next/navigation";

import { requireWorkspace, getProject, listRepoAliases } from "@/lib/queries";
import { ProjectSettingsForm } from "@/components/projects/project-settings-form";
import { RepoAliasManager } from "@/components/projects/repo-alias-manager";

/**
 * Project Settings page — editable project fields + repo aliases.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04c-ui-docs-e2e/plan.md §2.1
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ wid: string; pid: string }>;
}) {
  const { wid, pid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const project = await getProject(wid, pid);
  if (!project) notFound();

  const aliases = await listRepoAliases(wid, pid);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid="project-settings-page">
      <h1 className="text-[18px] font-semibold text-txt-primary">Project Settings</h1>

      <ProjectSettingsForm
        workspaceId={wid}
        projectId={pid}
        initialName={project.name}
        initialIdentifier={project.identifier}
        initialDescription={project.description}
        initialRepoUrl={project.repoUrl}
      />

      <RepoAliasManager
        workspaceId={wid}
        projectId={pid}
        aliases={aliases.map((a) => ({ id: a.id, aliasUrl: a.aliasUrl, createdAt: a.createdAt }))}
      />
    </div>
  );
}
