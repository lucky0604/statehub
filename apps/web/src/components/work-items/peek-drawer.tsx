"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import type { State, Label, Feature, WorkItem, EventRow } from "@statehub/domain";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api-client";

interface Props {
  workspaceId: string;
  projectId: string;
  workItemId: string;
  states: State[];
  labels: Label[];
  features: Feature[];
  onClose: () => void;
  onPatchQuery: (patch: Record<string, string | string[] | null>) => void;
}

/**
 * Work Item Peek (§10.3) — a right-side drawer overlay.
 *
 * Driven by ?peek=<id>. Opening it does NOT navigate (the list/kanban stays
 * mounted → scroll preserved). Escape closes (removes ?peek). The drawer fetches
 * the work item + label ids + recent events from the API.
 */
export function PeekDrawer({
  workspaceId,
  projectId,
  workItemId,
  states,
  labels,
  features,
  onClose,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [item, setItem] = useState<WorkItem | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const basePath = `/api/workspaces/${workspaceId}/projects/${projectId}/work-items`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wi, labelsRes, evs] = await Promise.all([
        api.get<WorkItem>(`${basePath}/${workItemId}`),
        api.get<{ labelIds: string[] }>(`${basePath}/${workItemId}/labels`),
        api
          .get<EventRow[]>(`${basePath}/${workItemId}/events`)
          .catch(() => [] as EventRow[]),
      ]);
      setItem(wi);
      setLabelIds(labelsRes.labelIds);
      setEvents(evs);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load work item");
    } finally {
      setLoading(false);
    }
  }, [basePath, workItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes Peek (§10.3 rule 3).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function changeState(stateId: string) {
    if (!item || busy) return;
    setBusy(true);
    const prev = item;
    // Optimistic: update local state group via the states list.
    const target = states.find((s) => s.id === stateId);
    setItem({
      ...prev,
      stateId,
      statusGroup: target?.statusGroup ?? prev.statusGroup,
    });
    try {
      await api.post(`${basePath}/${workItemId}/status`, { stateId });
      startTransition(() => router.refresh());
      void load(); // refresh events
    } catch (e) {
      setItem(prev); // rollback
      setError(e instanceof ApiError ? e.message : "Failed to change state");
    } finally {
      setBusy(false);
    }
  }

  const labelById = new Map(labels.map((l) => [l.id, l]));
  const featureById = new Map(features.map((f) => [f.id, f]));
  const feature = item?.featureId ? featureById.get(item.featureId) : undefined;

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 z-30 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Work item peek"
        className="fixed right-0 top-0 z-40 flex h-full w-[min(560px,100vw)] flex-col border-l border-border-subtle bg-surface-1 shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
          {item ? (
            <div className="flex items-center gap-2">
              <span className="font-mono-app text-[12px] text-accent">
                {item.projectIdentifier}-{item.sequenceId}
              </span>
              <StatusBadge group={item.statusGroup} />
            </div>
          ) : (
            <span className="text-[12px] text-txt-tertiary">Loading…</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close peek"
            className="rounded-md p-1 text-txt-tertiary hover:bg-surface-2 hover:text-txt-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="text-[13px] text-txt-tertiary">Loading…</div>
          ) : error && !item ? (
            <div className="text-[13px] text-danger">{error}</div>
          ) : item ? (
            <div className="space-y-4">
              {error ? <div className="text-[12px] text-danger">{error}</div> : null}

              {/* Title */}
              <h1 className="text-[17px] font-semibold text-txt-primary">{item.title}</h1>

              {/* Properties */}
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <Prop label="State">
                  <select
                    value={item.stateId ?? ""}
                    onChange={(e) => void changeState(e.target.value)}
                    disabled={busy}
                    className="h-7 rounded-md border border-border-subtle bg-surface-2 px-1.5 text-[12px] text-txt-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  >
                    <option value="">Unset</option>
                    {states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Prop>
                <Prop label="Priority">
                  <span className="capitalize text-txt-secondary">{item.priority}</span>
                </Prop>
                <Prop label="Feature">
                  {feature ? (
                    <span className="text-txt-secondary">{feature.name}</span>
                  ) : (
                    <span className="text-txt-tertiary italic">None</span>
                  )}
                </Prop>
                <Prop label="Source">
                  <span className="capitalize text-txt-secondary">{item.source}</span>
                </Prop>
                <Prop label="Confidence">
                  <span className="capitalize text-txt-secondary">{item.confidence}</span>
                </Prop>
                <Prop label="Type">
                  <span className="capitalize text-txt-secondary">{item.type}</span>
                </Prop>
              </div>

              {/* Labels */}
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-txt-tertiary">Labels</div>
                <div className="flex flex-wrap gap-1">
                  {labelIds.length === 0 ? (
                    <span className="text-[12px] text-txt-tertiary italic">None</span>
                  ) : (
                    labelIds.map((lid) => {
                      const lbl = labelById.get(lid);
                      if (!lbl) return null;
                      return (
                        <span
                          key={lid}
                          className="rounded-xs px-1.5 py-0.5 text-[11px] text-txt-secondary"
                          style={{ backgroundColor: (lbl.color ?? "#6B7280") + "22" }}
                        >
                          {lbl.name}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-txt-tertiary">Description</div>
                {item.descriptionMarkdown ? (
                  <div className="whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-2 p-3 text-[13px] leading-relaxed text-txt-secondary">
                    {item.descriptionMarkdown}
                  </div>
                ) : (
                  <p className="text-[12px] text-txt-tertiary italic">No description.</p>
                )}
              </div>

              {/* Activity (events) */}
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-txt-tertiary">Activity</div>
                {events.length === 0 ? (
                  <p className="text-[12px] text-txt-tertiary italic">No activity yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {events.map((ev) => (
                      <li key={ev.id} className="flex items-start gap-2 text-[12px]">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                        <div>
                          <span className="font-medium text-txt-primary">{ev.eventType}</span>
                          <span className="ml-1.5 text-txt-tertiary">by {ev.actorName}</span>
                          <span className="ml-1.5 text-txt-tertiary">
                            {new Date(ev.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-txt-tertiary">{label}</div>
      <div className="mt-0.5 text-[12px] text-txt-primary">{children}</div>
    </div>
  );
}
