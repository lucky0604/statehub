"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/lib/api-client";
import type { FindingStatus } from "@statehub/domain";

/**
 * Finding Actions — the inline mutation surface for a single finding.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p03c-ui-e2e-docs/plan.md §2.2
 *
 * Client component because it calls the API directly + uses router.refresh()
 * to re-render the server-rendered FindingCard. The state machine (phase-03 §6)
 * dictates which buttons are visible per current status:
 *
 *   open       → Accept | Dismiss
 *   accepted   → Mark fixed
 *   fixed      → Reopen
 *   dismissed  → Reopen
 *   wontfix    → (none)
 *   reopened   → Accept | Dismiss
 *
 * Dismiss opens an inline form for the reason (required by the /dismiss route).
 */
interface Props {
  workspaceId: string;
  projectId: string;
  reviewId: string;
  findingId: string;
  status: FindingStatus;
}

const TRANSITIONS: Record<FindingStatus, Array<{ label: string; to: FindingStatus; dismiss?: boolean }>> = {
  open: [
    { label: "Accept", to: "accepted" },
    { label: "Dismiss", to: "dismissed", dismiss: true },
  ],
  accepted: [{ label: "Mark fixed", to: "fixed" }],
  fixed: [{ label: "Reopen", to: "reopened" }],
  dismissed: [{ label: "Reopen", to: "reopened" }],
  wontfix: [],
  reopened: [
    { label: "Accept", to: "accepted" },
    { label: "Dismiss", to: "dismissed", dismiss: true },
  ],
};

export function FindingActions({ workspaceId, projectId, reviewId, findingId, status }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [reason, setReason] = useState("");

  const base = `/api/workspaces/${workspaceId}/projects/${projectId}/reviews/${reviewId}/findings/${findingId}`;

  async function patch(to: FindingStatus) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(base, { to_status: to });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitDismiss() {
    if (!reason.trim()) {
      setError("Reason is required to dismiss");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/dismiss`, { reason });
      setDismissOpen(false);
      setReason("");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Dismiss failed");
    } finally {
      setBusy(false);
    }
  }

  const transitions = TRANSITIONS[status] ?? [];

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="finding-actions">
      {transitions.map((t) => (
        <button
          key={t.label}
          type="button"
          disabled={busy}
          onClick={() => (t.dismiss ? setDismissOpen((v) => !v) : void patch(t.to))}
          className={cn(
            "rounded-md border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50",
            t.to === "accepted"
              ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
              : t.to === "fixed"
                ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
                : t.to === "dismissed"
                  ? "border-border-subtle bg-surface-2 text-txt-secondary hover:bg-surface-1"
                  : "border-border-subtle bg-surface-2 text-txt-secondary hover:bg-surface-1",
          )}
        >
          {t.label}
        </button>
      ))}

      {dismissOpen ? (
        <div className="mt-1 flex w-full items-center gap-1.5">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            disabled={busy}
            className="h-7 flex-1 rounded-md border border-border-subtle bg-surface-2 px-2 text-[12px] text-txt-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitDismiss()}
            className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDismissOpen(false);
              setReason("");
            }}
            className="rounded-md border border-border-subtle bg-surface-2 px-2 py-0.5 text-[11px] text-txt-secondary"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {error ? <span className="w-full text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
