import { notFound } from "next/navigation";

import { requireWorkspace, listProjects } from "@/lib/queries";
import { LocalMcpSetup } from "@/components/local-mcp/local-mcp-setup";

/**
 * Local MCP setup page — renders config template + OpenCode/Codex snippets +
 * trust model explainer. Workspace-scoped (project is selected in the page).
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04c-ui-docs-e2e/plan.md §2.2
 *
 * remoteUrl is read from NEXT_PUBLIC_REMOTE_URL at build time. Defaults to
 * http://localhost:3000 for dev.
 */
export default async function LocalMcpSetupPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const projects = await listProjects(wid);
  const remoteUrl = process.env.NEXT_PUBLIC_REMOTE_URL ?? "http://localhost:3000";

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6" data-testid="local-mcp-setup-page">
      <header>
        <h1 className="text-[18px] font-semibold text-txt-primary">Local MCP</h1>
        <p className="mt-1 text-[12px] text-txt-secondary">
          Wire the StateHub local sidecar into your coding agent. The sidecar reads git context from your repo and syncs evidence to Remote StateHub.
        </p>
      </header>

      <LocalMcpSetup
        remoteUrl={remoteUrl}
        workspaceSlug={ws.slug}
        projects={projects.map((p) => ({ slug: p.slug, name: p.name }))}
      />
    </div>
  );
}
