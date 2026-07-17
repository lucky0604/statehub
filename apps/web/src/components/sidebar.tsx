"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  ListFilter,
  Plug,
  ScanSearch,
  Settings,
  Sparkles,
  Target,
} from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Sidebar — 248px primary navigation.
 * Source: design system §9.1
 *
 * P01A: Portfolio links to the real home page.
 * P02C: Agent Runs + Settings link to real workspace-scoped routes when a
 * workspace exists; otherwise they fall back to disabled placeholders.
 */
type NavItem = {
  label: string;
  icon: typeof LayoutDashboard;
  href: string | null;
};

export function Sidebar({
  workspaceId,
  className,
}: {
  workspaceId: string | null;
  className?: string;
}) {
  const pathname = usePathname();

  const navItems: NavItem[] = [
    { label: "Portfolio", icon: LayoutDashboard, href: "/" },
    { label: "Projects", icon: FolderKanban, href: "/" },
    { label: "Saved Views", icon: ListFilter, href: "/" },
    { label: "Current Focus", icon: Target, href: "/" },
    {
      label: "Reviews",
      icon: ScanSearch,
      href: workspaceId ? `/workspaces/${workspaceId}/reviews` : null,
    },
    {
      label: "AI PM",
      icon: Sparkles,
      href: workspaceId ? `/workspaces/${workspaceId}/ai-pm` : null,
    },
    {
      label: "Agent Runs",
      icon: Bot,
      href: workspaceId ? `/workspaces/${workspaceId}/agent-runs` : null,
    },
    { label: "Decisions", icon: GitBranch, href: "/" },
    {
      label: "Local MCP",
      icon: Plug,
      href: workspaceId ? `/workspaces/${workspaceId}/settings/local-mcp` : null,
    },
    {
      label: "Settings",
      icon: Settings,
      href: workspaceId ? `/workspaces/${workspaceId}/settings/tokens` : null,
    },
  ];

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
        {navItems.map(({ label, icon: Icon, href }) => {
          const isPortfolioRoot = href === "/" && pathname === "/" && label === "Portfolio";
          const isWorkspaceRoute =
            href && href !== "/" && pathname === href;
          const active = isPortfolioRoot || isWorkspaceRoute;
          const disabled = href === null;

          const content = (
            <>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </>
          );

          const className = cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
            disabled
              ? "cursor-not-allowed text-txt-placeholder"
              : active
                ? "bg-layer-2 text-txt-primary"
                : "text-txt-secondary hover:bg-layer-2 hover:text-txt-primary",
          );

          return (
            <li key={label}>
              {disabled ? (
                <span
                  aria-disabled
                  className={className}
                  title="No workspace yet"
                >
                  {content}
                </span>
              ) : (
                <Link
                  href={href}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={className}
                >
                  {content}
                </Link>
              )}
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
