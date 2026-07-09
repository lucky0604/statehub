import {
  Bot,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  ListFilter,
  ScanSearch,
  Settings,
  Target,
} from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Sidebar — 248px primary navigation.
 * Source: design system §9.1
 *
 * P00: all 8 nav items are placeholders. No real routes yet.
 * Real routes land P01A onwards.
 */
const NAV_ITEMS = [
  { label: "Portfolio", icon: LayoutDashboard },
  { label: "Projects", icon: FolderKanban },
  { label: "Saved Views", icon: ListFilter },
  { label: "Current Focus", icon: Target },
  { label: "Reviews", icon: ScanSearch },
  { label: "Agent Runs", icon: Bot },
  { label: "Decisions", icon: GitBranch },
  { label: "Settings", icon: Settings },
] as const;

export function Sidebar({ className }: { className?: string }) {
  return (
    <nav
      className={cn(
        "flex w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border-subtle bg-surface-1 py-3",
        className,
      )}
      aria-label="Primary navigation"
      data-testid="sidebar"
    >
      <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
        Navigation
      </div>
      <ul className="flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map(({ label, icon: Icon }) => (
          <li key={label}>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-txt-secondary hover:bg-layer-2 hover:text-txt-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              aria-label={label}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-auto px-3 pt-4 text-[11px] text-txt-tertiary">
        No project selected
      </div>
    </nav>
  );
}
