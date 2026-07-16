import { CommandPalette } from "./command-palette";
import { RightRail } from "./right-rail";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { getCurrentWorkspace } from "@/lib/queries";

/**
 * AppShell — the global app chrome.
 * Source: agent_flow/statehub-design-system.md §9.1
 *
 * Layout at desktop (lg+):
 *   ┌ TopBar (48px) ────────────────────────────────────────┐
 *   │ Sidebar(248) │ MainCanvas (flex) │ RightRail (336)     │
 *   └────────────────────────────────────────────────────────┘
 *
 * Below lg:
 *   - Sidebar collapses to icon rail then sheet (P01A wires the trigger).
 *   - RightRail hides (hidden lg:flex).
 *
 * P02C: AppShell is now an async server component — it resolves the current
 * workspace once so the Sidebar (workspace-scoped links) and TopBar (MCP sync
 * indicator) can render real hrefs/state. A missing workspace (fresh install)
 * renders the shell with placeholders.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const ws = await getCurrentWorkspace();
  const workspaceId = ws?.id ?? null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-canvas">
      <TopBar workspaceId={workspaceId} />
      <div className="flex min-h-0 flex-1">
        <Sidebar workspaceId={workspaceId} />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </main>
        <RightRail />
      </div>
      <CommandPalette />
    </div>
  );
}
