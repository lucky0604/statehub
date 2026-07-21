import { notFound } from "next/navigation";

import { requireWorkspace, getMarkdownExport, listProjects } from "@/lib/queries";
import { MarkdownExportPane } from "@/components/export/markdown-export-pane";

/**
 * Markdown export page — generate + download a deterministic snapshot of
 * workspace state for sharing with reviewers or for archival.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5.4
 */
export default async function ExportPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const projects = await listProjects(wid);
  const initial = await getMarkdownExport(wid);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4 p-4">
      <header className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <h1 className="text-[18px] font-semibold text-txt-primary">Markdown export</h1>
        <p className="mt-0.5 text-[12px] text-txt-secondary">
          Generate a single markdown snapshot of the workspace (or one project)
          for sharing, archival, or external review.
        </p>
      </header>

      <MarkdownExportPane
        workspaceId={wid}
        projects={projects.map((p) => ({ id: p.id, name: p.name, identifier: p.identifier }))}
        initialMarkdown={initial.markdown}
        initialByteLength={initial.byteLength}
        initialProjectIds={initial.projectIds}
      />
    </div>
  );
}
