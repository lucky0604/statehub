import { CommandPalette } from "./command-palette";
import { RightRail } from "./right-rail";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";

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
 * No feature-specific UI lives here. All eight nav items are placeholders.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-canvas">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </main>
        <RightRail />
      </div>
      <CommandPalette />
    </div>
  );
}
