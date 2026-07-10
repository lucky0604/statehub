"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 * P01A: Portfolio links to the real home page. The rest remain placeholders —
 * their routes land in later phases (P01B/P01C/P02+).
 */
const NAV_ITEMS = [
  { label: "Portfolio", icon: LayoutDashboard, href: "/" },
  { label: "Projects", icon: FolderKanban, href: "/" },
  { label: "Saved Views", icon: ListFilter, href: "/" },
  { label: "Current Focus", icon: Target, href: "/" },
  { label: "Reviews", icon: ScanSearch, href: "/" },
  { label: "Agent Runs", icon: Bot, href: "/" },
  { label: "Decisions", icon: GitBranch, href: "/" },
  { label: "Settings", icon: Settings, href: "/" },
] as const;

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
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
        {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
          const active = href === "/" && pathname === "/" && label === "Portfolio";
          return (
            <li key={label}>
              <Link
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
                  active
                    ? "bg-layer-2 text-txt-primary"
                    : "text-txt-secondary hover:bg-layer-2 hover:text-txt-primary",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto px-3 pt-4 text-[11px] text-txt-tertiary">
        Solo workspace
      </div>
    </nav>
  );
}
