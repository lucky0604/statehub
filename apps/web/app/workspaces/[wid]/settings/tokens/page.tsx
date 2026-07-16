import { notFound } from "next/navigation";

import { requireWorkspace, listTokens, getMcpSync } from "@/lib/queries";
import { TokenManager } from "@/components/tokens/token-manager";
import { McpSyncIndicator } from "@/components/mcp-sync/mcp-sync-indicator";

/**
 * Token Settings page — issue + revoke personal access tokens for remote agents.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §5
 *         agent_flow/implementation/v1/iterations/20260715-p02c-agent-sync-ui-docs/plan.md §3
 *
 * The raw token is shown ONCE on issuance (TokenManager handles the one-time
 * banner). The server passes the initial non-revoked list; mutations refresh
 * via router.refresh().
 */
export default async function TokensSettingsPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const [initial, sync] = await Promise.all([listTokens(wid), getMcpSync(wid)]);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 p-4">
      <header className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-[18px] font-semibold text-txt-primary">Tokens</h1>
            <p className="mt-0.5 text-[12px] text-txt-secondary">
              Personal access tokens let coding agents authenticate to the
              remote MCP server. Raw tokens are shown once on issuance.
            </p>
          </div>
          <McpSyncIndicator summary={sync} />
        </div>
      </header>

      <TokenManager workspaceId={wid} initial={initial} />
    </div>
  );
}
