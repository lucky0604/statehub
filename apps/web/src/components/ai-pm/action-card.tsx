"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AiPmActionCard } from "@statehub/domain";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/lib/api-client";
import { ConfirmationModal } from "./confirmation-modal";

/**
 * Action Card — one proposed action from the AI PM.
 *
 * Source: phase-05 §5 (action card lifecycle), §8 (safety rules).
 *
 * States:
 *   pending    → Apply | Edit | Dismiss
 *   applied    → show "Applied" badge + result kind
 *   dismissed  → show "Dismissed" badge
 *
 * High-risk cards show a red badge + open the ConfirmationModal on Apply.
 * Edit mode swaps the payload preview for a JSON textarea; the edited
 * payload is sent as edited_payload on Apply (the server re-validates).
 */
interface Props {
  workspaceId: string;
  card: AiPmActionCard;
}

export function ActionCard({ workspaceId, card }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedPayload, setEditedPayload] = useState<string>(
    JSON.stringify(JSON.parse(card.payloadJson), null, 2),
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

  const base = `/api/workspaces/${workspaceId}/ai-pm/actions/${card.id}`;
  const isHighRisk = card.requiresConfirmation;

  async function handleApply() {
    setBusy(true);
    setError(null);
    try {
      const payloadToSend = editing
        ? safeParse(editedPayload)
        : undefined;
      await api.post(`${base}/apply`, {
        edited_payload: payloadToSend,
        // Coerce to boolean — card.requiresConfirmation is stored as 0/1
        // (integer) in the DB, so it arrives as a number, not a boolean.
        confirm_high_risk: Boolean(isHighRisk),
      });
      setConfirmOpen(false);
      setEditing(false);
      router.refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Apply failed";
      if (e instanceof ApiError && e.code === "done_gate_blocked") {
        setError(`Done Gate blocked: ${msg}`);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss() {
    if (isHighRisk && !dismissReason.trim()) {
      setEditError("Reason required to dismiss a high-risk action");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/dismiss`, {
        reason: dismissReason.trim() || undefined,
      });
      setDismissOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Dismiss failed");
    } finally {
      setBusy(false);
    }
  }

  function safeParse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  function validateEdit(text: string): string | null {
    try {
      JSON.parse(text);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON";
    }
  }

  const statusBadge =
    card.status === "applied" ? (
      <span className="rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
        Applied
      </span>
    ) : card.status === "dismissed" ? (
      <span className="rounded-md bg-layer-2 px-2 py-0.5 text-[11px] font-medium text-txt-tertiary">
        Dismissed
      </span>
    ) : isHighRisk ? (
      <span className="rounded-md bg-danger/15 px-2 py-0.5 text-[11px] font-medium text-danger">
        High-risk
      </span>
    ) : (
      <span className="rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
        Pending
      </span>
    );

  return (
    <div
      className="rounded-md border border-border-subtle bg-surface-1 p-3"
      data-testid="action-card"
      data-action-id={card.id}
      data-action-type={card.actionType}
      data-status={card.status}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {statusBadge}
          <span className="text-[11px] font-mono text-txt-tertiary">
            {card.actionType}
          </span>
        </div>
      </div>

      <h4 className="mt-2 text-[13px] font-semibold text-txt-primary">
        {card.title}
      </h4>

      {card.reason ? (
        <p className="mt-1 text-[12px] text-txt-secondary">{card.reason}</p>
      ) : null}

      {card.risk ? (
        <p className="mt-1 text-[12px] text-warning">Risk: {card.risk}</p>
      ) : null}

      {editing ? (
        <div className="mt-2" data-testid="payload-editor">
          <textarea
            value={editedPayload}
            onChange={(e) => {
              setEditedPayload(e.target.value);
              setEditError(validateEdit(e.target.value));
            }}
            rows={6}
            className="w-full rounded-md border border-border-subtle bg-surface-2 p-2 font-mono text-[11px] text-txt-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            data-testid="payload-editor-textarea"
          />
          {editError ? (
            <p className="mt-1 text-[11px] text-danger">{editError}</p>
          ) : null}
        </div>
      ) : (
        <pre className="mt-2 max-h-32 overflow-auto rounded-md border border-border-subtle bg-surface-2 p-2 text-[11px] font-mono text-txt-secondary">
          {JSON.stringify(JSON.parse(card.payloadJson), null, 2)}
        </pre>
      )}

      {card.status === "pending" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busy || (editing && editError !== null)}
            onClick={() => (isHighRisk ? setConfirmOpen(true) : void handleApply())}
            className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-on-accent disabled:opacity-50"
            data-testid="apply-btn"
          >
            Apply
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing((v) => !v)}
            className={cn(
              "rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1 text-[11px] text-txt-secondary hover:bg-surface-1 disabled:opacity-50",
            )}
          >
            {editing ? "Cancel edit" : "Edit"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setDismissOpen((v) => !v)}
            className="rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1 text-[11px] text-txt-secondary hover:bg-surface-1 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {dismissOpen ? (
        <div className="mt-2 flex flex-col gap-1.5" data-testid="dismiss-form">
          {isHighRisk ? (
            <input
              type="text"
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Reason (required for high-risk)"
              disabled={busy}
              className="h-7 rounded-md border border-border-subtle bg-surface-2 px-2 text-[12px] text-txt-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              data-testid="dismiss-reason-input"
            />
          ) : null}
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDismiss()}
              className="rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1 text-[11px] text-txt-secondary hover:bg-surface-1 disabled:opacity-50"
            >
              Confirm dismiss
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDismissOpen(false);
                setDismissReason("");
              }}
              className="rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1 text-[11px] text-txt-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-[11px] text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {confirmOpen ? (
        <ConfirmationModal
          actionType={card.actionType}
          title={card.title}
          risk={card.risk}
          payloadPreview={editing ? editedPayload : card.payloadJson}
          onConfirm={handleApply}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}
