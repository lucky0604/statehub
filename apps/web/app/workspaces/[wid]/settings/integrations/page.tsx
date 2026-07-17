import { notFound } from "next/navigation";

import {
  requireWorkspace,
  listProjects,
  listExternalLinks,
} from "@/lib/queries";
import { ExternalLinkManager } from "@/components/external-links/external-link-manager";

/**
 * Integrations settings page — manage external links (PR URLs, issue URLs)
 * that tie StateHub entities to external resources.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5
 */
export default async function IntegrationsSettingsPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const [projects, links] = await Promise.all([
    listProjects(wid),
    listExternalLinks(wid),
  ]);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4 p-4">
      <header className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <h1 className="text-[18px] font-semibold text-txt-primary">Integrations</h1>
        <p className="mt-0.5 text-[12px] text-txt-secondary">
          External links tie StateHub features, work items, evidence, and
          decisions to PRs, issues, and other remote resources. Re-linking the
          same resource is idempotent.
        </p>
      </header>

      <ExternalLinkManager
        workspaceId={wid}
        projects={projects.map((p) => ({ id: p.id, name: p.name, identifier: p.identifier }))}
        initialLinks={links}
      />
    </div>
  );
}
