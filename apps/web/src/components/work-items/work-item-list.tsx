"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";

import type { State, Label, Feature, WorkItem } from "@statehub/domain";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/lib/api-client";

interface Props {
  workspaceId: string;
  projectId: string;
  states: State[];
  labels: Label[];
  features: Feature[];
  items: WorkItem[];
  labelIdsByItem: Map<string, string[]>;
  onOpenPeek: (id: string) => void;
}

const ROW_H = 36; // stable row height (§4.4)

/**
 * Work Items List — table with sticky header, row selection, bulk action bar.
 *
 * Row click opens Peek (onOpenPeek). Checkbox selects for bulk actions. Bulk
 * status change calls the bulk-status endpoint and refreshes.
 */
export function WorkItemList({
  workspaceId,
  projectId,
  states,
  labels,
  features,
  items,
  labelIdsByItem,
  onOpenPeek,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const stateById = new Map(states.map((s) => [s.id, s]));
  const featureById = new Map(features.map((f) => [f.id, f]));
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const allSelected = items.length > 0 && selected.size === items.length;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id)),
    );
  }

  async function bulkChangeState(stateId: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(
        `/api/workspaces/${workspaceId}/projects/${projectId}/work-items/bulk-status`,
        { ids: [...selected], stateId },
      );
      setSelected(new Set());
      setBulkOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Bulk change failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border-subtle bg-accent/5 px-3">
          <span className="text-[12px] font-medium text-accent">
            {selected.size} selected
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setBulkOpen((v) => !v)}
              disabled={busy}
              className="flex h-7 items-center gap-1 rounded-md border border-border-subtle bg-surface-1 px-2 text-[12px] text-txt-primary disabled:opacity-50"
            >
              Change state <ChevronDown className="h-3 w-3" />
            </button>
            {bulkOpen ? (
              <div className="absolute left-0 top-8 z-20 w-44 rounded-md border border-border-subtle bg-surface-1 py-1 shadow-lg">
                {states.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void bulkChangeState(s.id)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[12px] text-txt-primary hover:bg-surface-2"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: s.color ?? "#9CA3AF" }}
                      aria-hidden
                    />
                    {s.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[12px] text-txt-tertiary hover:text-txt-primary"
          >
            Clear
          </button>
          {error ? <span className="text-[11px] text-danger">{error}</span> : null}
        </div>
      ) : null}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-txt-tertiary">
            No work items match the current filters.
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface-1">
              <tr className="border-b border-border-subtle text-left text-[11px] uppercase tracking-wide text-txt-tertiary">
                <th className="w-8 border-b border-border-subtle px-2" style={{ height: ROW_H }}>
                  <button
                    type="button"
                    onClick={toggleAll}
                    aria-label="Select all"
                    aria-pressed={allSelected}
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-xs border",
                      allSelected
                        ? "border-accent bg-accent text-on-accent"
                        : "border-border-subtle bg-surface-2",
                    )}
                  >
                    {allSelected ? <Check className="h-3 w-3" /> : null}
                  </button>
                </th>
                <th className="border-b border-border-subtle px-2 font-medium">ID</th>
                <th className="border-b border-border-subtle px-2 font-medium">Title</th>
                <th className="border-b border-border-subtle px-2 font-medium">State</th>
                <th className="border-b border-border-subtle px-2 font-medium">Priority</th>
                <th className="border-b border-border-subtle px-2 font-medium">Labels</th>
                <th className="border-b border-border-subtle px-2 font-medium">Feature</th>
              </tr>
            </thead>
            <tbody>
              {items.map((wi) => {
                const state = wi.stateId ? stateById.get(wi.stateId) : undefined;
                const ids = labelIdsByItem.get(wi.id) ?? [];
                const feature = wi.featureId ? featureById.get(wi.featureId) : undefined;
                const isSel = selected.has(wi.id);
                return (
                  <tr
                    key={wi.id}
                    className={cn(
                      "group cursor-pointer border-b border-border-subtle hover:bg-surface-2",
                      isSel && "bg-accent/5",
                    )}
                    style={{ height: ROW_H }}
                    onClick={() => onOpenPeek(wi.id)}
                  >
                    <td
                      className="px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOne(wi.id);
                      }}
                    >
                      <span
                        role="checkbox"
                        aria-checked={isSel}
                        tabIndex={0}
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-xs border",
                          isSel
                            ? "border-accent bg-accent text-on-accent"
                            : "border-border-subtle bg-surface-2 group-hover:border-txt-tertiary",
                        )}
                      >
                        {isSel ? <Check className="h-3 w-3" /> : null}
                      </span>
                    </td>
                    <td className="px-2 font-mono-app text-[11px] text-txt-tertiary">
                      {wi.projectIdentifier}-{wi.sequenceId}
                    </td>
                    <td className="max-w-[320px] truncate px-2 text-txt-primary">
                      {wi.title}
                    </td>
                    <td className="px-2">
                      {state ? (
                        <span className="flex items-center gap-1.5 text-[12px] text-txt-secondary">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: state.color ?? "#9CA3AF" }}
                            aria-hidden
                          />
                          {state.name}
                        </span>
                      ) : (
                        <span className="text-[11px] text-txt-tertiary italic">Unset</span>
                      )}
                    </td>
                    <td className="px-2">
                      <span className="text-[12px] capitalize text-txt-secondary">{wi.priority}</span>
                    </td>
                    <td className="px-2">
                      <div className="flex flex-wrap gap-1">
                        {ids.slice(0, 3).map((lid) => {
                          const lbl = labelById.get(lid);
                          if (!lbl) return null;
                          return (
                            <span
                              key={lid}
                              className="rounded-xs px-1.5 py-0.5 text-[10px] text-txt-secondary"
                              style={{
                                backgroundColor: (lbl.color ?? "#6B7280") + "22",
                              }}
                            >
                              {lbl.name}
                            </span>
                          );
                        })}
                        {ids.length > 3 ? (
                          <span className="text-[10px] text-txt-tertiary">+{ids.length - 3}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 text-[12px] text-txt-secondary">
                      {feature ? feature.name : <span className="text-txt-tertiary">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
