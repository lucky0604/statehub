import { McpSyncIndicator } from "./mcp-sync/mcp-sync-indicator";
import { getMcpSync } from "@/lib/queries";
import { cn } from "../lib/cn";
import { ThemeToggle } from "./theme-toggle";

/**
 * TopBar — 48px high global header.
 * Source: design system §9.1
 *
 * P02C: MCP sync indicator is now real (derived from agent_runs + tokens).
 * Workspace switcher, breadcrumbs, and user menu remain placeholders.
 */
export async function TopBar({
  workspaceId,
  className,
}: {
  workspaceId: string | null;
  className?: string;
}) {
  const sync = workspaceId ? await getMcpSync(workspaceId) : null;

  return (
    <header
      className={cn(
        "flex h-[var(--topbar-height)] items-center gap-3 border-b border-border-subtle bg-surface-1 px-4",
        className,
      )}
      data-testid="topbar"
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-txt-primary">
        <span className="font-mono-app text-[14px] tracking-tight">
          statehub
        </span>
      </div>

      <div className="h-4 w-px bg-border-subtle" />

      <span className="text-[12px] text-txt-tertiary">
        Workspace switcher placeholder
      </span>

      <span className="text-[12px] text-txt-tertiary">
        / Breadcrumbs placeholder
      </span>

      <div className="ml-auto flex items-center gap-1">
        <kbd className="rounded border border-border-subtle bg-layer-2 px-1.5 py-0.5 font-mono-app text-[11px] text-txt-tertiary">
          ⌘K
        </kbd>
        <span className="text-[12px] text-txt-tertiary">Cmd+K placeholder</span>
        <span className="ml-2" aria-hidden />
        {sync ? (
          <McpSyncIndicator summary={sync} />
        ) : (
          <span className="text-[12px] text-txt-tertiary">MCP not configured</span>
        )}
        <ThemeToggle />
        <span className="ml-2 text-[12px] text-txt-tertiary">User menu placeholder</span>
      </div>
    </header>
  );
}
