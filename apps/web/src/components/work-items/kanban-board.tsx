"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

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

const COL_W = 296; // §10.2 column width

/**
 * Work Items Kanban (§10.2) — columns by state, drag a card across columns to
 * change state. Uses native HTML5 drag (no dependency). Optimistic local move,
 * rollback on API error.
 */
export function KanbanBoard({
  workspaceId,
  projectId,
  states,
  labels,
  features,
  items,
  labelIdsByItem,
  onOpenPeek,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [localOverride, setLocalOverride] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const labelById = new Map(labels.map((l) => [l.id, l]));
  const featureById = new Map(features.map((f) => [f.id, f]));

  // Resolve each item's state: local override (optimistic) > stored state_id.
  const stateOf = (wi: WorkItem) => localOverride.get(wi.id) ?? wi.stateId ?? null;
  const byColumn = new Map<string, WorkItem[]>();
  for (const s of states) byColumn.set(s.id, []);
  const unassigned: WorkItem[] = [];
  for (const wi of items) {
    const sid = stateOf(wi);
    const bucket = sid ? byColumn.get(sid) : null;
    if (bucket) bucket.push(wi);
    else unassigned.push(wi);
  }

  async function changeState(wi: WorkItem, targetStateId: string) {
    const sourceStateId = stateOf(wi);
    if (sourceStateId === targetStateId) return;
    setError(null);
    // Optimistic: move the card locally.
    setLocalOverride((prev) => {
      const next = new Map(prev);
      next.set(wi.id, targetStateId);
      return next;
    });
    try {
      await api.post(
        `/api/workspaces/${workspaceId}/projects/${projectId}/work-items/${wi.id}/status`,
        { stateId: targetStateId },
      );
      startTransition(() => router.refresh());
    } catch (e) {
      // Rollback.
      setLocalOverride((prev) => {
        const next = new Map(prev);
        next.delete(wi.id);
        return next;
      });
      setError(e instanceof ApiError ? e.message : "Failed to change state");
    }
  }

  return (
    <div className="flex h-full flex-col">
      {error ? (
        <div className="shrink-0 bg-danger/10 px-3 py-1 text-[12px] text-danger">{error}</div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {states.map((s) => {
          const col = byColumn.get(s.id) ?? [];
          const isOver = overCol === s.id;
          return (
            <div
              key={s.id}
              className="flex shrink-0 flex-col"
              style={{ width: COL_W }}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== s.id) setOverCol(s.id);
              }}
              onDragLeave={(e) => {
                // only clear when leaving the column entirely
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setOverCol((c) => (c === s.id ? null : c));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                if (dragId) {
                  const wi = items.find((w) => w.id === dragId);
                  if (wi) void changeState(wi, s.id);
                }
                setDragId(null);
              }}
            >
              {/* Column header */}
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: s.color ?? "#9CA3AF" }}
                    aria-hidden
                  />
                  <span className="text-[12px] font-medium text-txt-primary">{s.name}</span>
                  <span className="text-[11px] text-txt-tertiary">{col.length}</span>
                </div>
                <button
                  type="button"
                  aria-label={`Add work item in ${s.name}`}
                  className="text-txt-tertiary hover:text-txt-primary"
                  onClick={() =>
                    onOpenPeek("__new__" + s.id) /* placeholder; create flow is P01C+ */
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Column body */}
              <div
                className={cn(
                  "min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md p-1.5 transition-colors",
                  isOver ? "bg-accent/5 ring-2 ring-inset ring-accent/30" : "bg-surface-1/40",
                )}
              >
                {col.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border-subtle px-2 py-6 text-center text-[11px] text-txt-tertiary">
                    Drop here
                  </div>
                ) : (
                  col.map((wi) => (
                    <KanbanCard
                      key={wi.id}
                      wi={wi}
                      labelIds={labelIdsByItem.get(wi.id) ?? []}
                      labelById={labelById}
                      feature={wi.featureId ? featureById.get(wi.featureId) : undefined}
                      dragging={dragId === wi.id}
                      onDragStart={() => setDragId(wi.id)}
                      onDragEnd={() => setDragId(null)}
                      onOpen={() => onOpenPeek(wi.id)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}

        {/* Unassigned column (items with no state) */}
        {unassigned.length > 0 ? (
          <div className="flex w-[296px] shrink-0 flex-col">
            <div className="mb-2 px-1 text-[12px] font-medium text-txt-tertiary">
              Unset <span className="text-[11px]">{unassigned.length}</span>
            </div>
            <div className="space-y-2 p-1.5">
              {unassigned.map((wi) => (
                <KanbanCard
                  key={wi.id}
                  wi={wi}
                  labelIds={labelIdsByItem.get(wi.id) ?? []}
                  labelById={labelById}
                  feature={wi.featureId ? featureById.get(wi.featureId) : undefined}
                  dragging={dragId === wi.id}
                  onDragStart={() => setDragId(wi.id)}
                  onDragEnd={() => setDragId(null)}
                  onOpen={() => onOpenPeek(wi.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function KanbanCard({
  wi,
  labelIds,
  labelById,
  feature,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  wi: WorkItem;
  labelIds: string[];
  labelById: Map<string, Label>;
  feature?: Feature;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", wi.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={cn(
        "cursor-pointer rounded-md border border-border-subtle bg-surface-1 p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        dragging && "opacity-40",
      )}
    >
      <div className="mb-1 font-mono-app text-[10px] text-txt-tertiary">
        {wi.projectIdentifier}-{wi.sequenceId}
      </div>
      <div className="mb-2 text-[13px] text-txt-primary">
        {wi.title.startsWith("[review_fix]") ? (
          <span className="mr-1 inline-flex items-center rounded-xs bg-warning/15 px-1 py-0.5 align-middle text-[10px] font-medium text-warning">
            review_fix
          </span>
        ) : null}
        {wi.title}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {wi.priority !== "none" ? (
          <span className="rounded-xs bg-layer-2 px-1.5 py-0.5 text-[10px] capitalize text-txt-secondary">
            {wi.priority}
          </span>
        ) : null}
        {labelIds.slice(0, 3).map((lid) => {
          const lbl = labelById.get(lid);
          if (!lbl) return null;
          return (
            <span
              key={lid}
              className="rounded-xs px-1.5 py-0.5 text-[10px] text-txt-secondary"
              style={{ backgroundColor: (lbl.color ?? "#6B7280") + "22" }}
            >
              {lbl.name}
            </span>
          );
        })}
        {feature ? (
          <span className="ml-auto truncate text-[10px] text-txt-tertiary">{feature.name}</span>
        ) : null}
      </div>
    </div>
  );
}
