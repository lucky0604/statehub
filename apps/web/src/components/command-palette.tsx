"use client";

import { Command as CommandPrimitive } from "cmdk";
import { useEffect, useState } from "react";

import { cn } from "../lib/cn";

/**
 * CommandPalette placeholder — Cmd+K opens an empty shadcn-style Command.
 * Source: design system §10.5
 *
 * P00: no commands registered. Real commands (search work items, go to focus,
 * create work item, ask AI PM, start review, record decision) land P01A+.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-black/40 p-4 pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
      data-testid="command-palette"
    >
      <CommandPrimitive
        className={cn(
          "w-full max-w-xl rounded-md border border-border-subtle bg-surface-1 shadow-modal",
        )}
        loop
        onClick={(e) => e.stopPropagation()}
      >
        <CommandPrimitive.Input
          placeholder="Type a command or search…"
          className="h-10 w-full border-b border-border-subtle bg-transparent px-3 text-[13px] text-txt-primary placeholder:text-txt-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        />
        <CommandPrimitive.List className="max-h-80 overflow-y-auto p-2">
          <CommandPrimitive.Empty className="px-3 py-6 text-center text-[12px] text-txt-tertiary">
            No commands registered yet.
          </CommandPrimitive.Empty>
        </CommandPrimitive.List>
      </CommandPrimitive>
    </div>
  );
}
