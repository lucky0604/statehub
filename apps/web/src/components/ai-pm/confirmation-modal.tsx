"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Confirmation Modal — shown before applying a high-risk action card.
 *
 * Source: phase-05 §8 safety rule 2 (high-risk actions require explicit
 * confirmation). The user must check "I confirm" before the Apply button
 * is enabled.
 */
interface Props {
  actionType: string;
  title: string;
  risk: string | null;
  payloadPreview: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function ConfirmationModal({
  actionType,
  title,
  risk,
  payloadPreview,
  onConfirm,
  onCancel,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApply() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      data-testid="confirmation-modal"
    >
      <div className="mx-4 w-full max-w-md rounded-lg border border-danger/40 bg-surface-1 p-4 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-danger/15 px-2 py-0.5 text-[11px] font-medium text-danger">
            High-risk
          </span>
          <h2
            id="confirm-modal-title"
            className="text-[14px] font-semibold text-txt-primary"
          >
            {actionType.replace(/_/g, " ")}
          </h2>
        </div>

        <p className="mt-3 text-[13px] text-txt-primary">{title}</p>

        {risk ? (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/5 p-2.5">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-danger">
              Risk
            </h3>
            <p className="mt-1 text-[12px] text-txt-secondary">{risk}</p>
          </div>
        ) : null}

        <div className="mt-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
            Payload
          </h3>
          <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border-subtle bg-surface-2 p-2 text-[11px] font-mono text-txt-secondary">
            {payloadPreview}
          </pre>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 rounded border-border-subtle"
            data-testid="confirm-checkbox"
          />
          <span className="text-[12px] text-txt-secondary">
            I understand the risk and confirm this action.
          </span>
        </label>

        {error ? (
          <p className="mt-2 text-[12px] text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border border-border-subtle bg-surface-2 px-3 py-1.5 text-[12px] text-txt-secondary hover:bg-surface-1 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!confirmed || busy}
            onClick={() => void handleApply()}
            className={cn(
              "rounded-md bg-danger px-3 py-1.5 text-[12px] font-medium text-on-accent disabled:opacity-50",
            )}
            data-testid="confirm-apply-btn"
          >
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
