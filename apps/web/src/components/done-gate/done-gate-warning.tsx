import type { DoneGateSummary } from "@statehub/domain";
import { cn } from "@/lib/cn";

/**
 * Done Gate v0 warning panel (phase-02 §6.2.1).
 *
 * Warning-only — never blocks. The UI surfaces "Ready for review" when the
 * gate is clean and the feature is in_progress; shows amber warnings for
 * missing test_result / untrusted evidence / missing evidence; shows neutral
 * info for open todos / no completed runs.
 *
 * Phase 03 wraps this with review-aware blocking. v0 stays advisory.
 */
interface Props {
  summary: DoneGateSummary;
  /** Hook for the "Mark as ready for review" button — phase 03 may upgrade. */
  onMarkReadyForReview?: () => void;
}

const CODE_LABELS: Record<DoneGateSummary["warnings"][number]["code"], string> = {
  missing_test_result: "Missing test result",
  untrusted_evidence: "Untrusted evidence",
  missing_evidence: "Missing evidence",
  open_todos: "Open todos",
  no_completed_runs: "No completed runs",
};

export function DoneGateWarning({ summary, onMarkReadyForReview }: Props) {
  const clean = summary.warnings.length === 0;
  const hasBlocking = summary.blockingCount > 0;

  return (
    <section
      className={cn(
        "rounded-md border p-3",
        clean
          ? "border-success/30 bg-success/5"
          : hasBlocking
            ? "border-warning/40 bg-warning/5"
            : "border-border-subtle bg-surface-1",
      )}
      aria-label="Done Gate"
      data-testid="done-gate"
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Done Gate
        </div>
        <span
          className={cn(
            "text-[10px] font-medium",
            clean ? "text-success" : hasBlocking ? "text-warning" : "text-txt-tertiary",
          )}
        >
          {clean ? "ready" : hasBlocking ? `${summary.blockingCount} warning(s)` : "advisory"}
        </span>
      </div>

      {clean ? (
        <p className="mt-1.5 text-[12px] text-txt-secondary">
          A completed agent run does not mean the feature is done. Move the feature
          to <span className="font-medium text-txt-primary">Needs review</span> when you have verified the work.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {summary.warnings.map((w) => (
            <li
              key={w.code}
              className="flex items-start gap-2 text-[12px]"
            >
              <span
                className={cn(
                  "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  w.severity === "warn" ? "bg-warning" : "bg-txt-tertiary",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-txt-primary">{CODE_LABELS[w.code]}</div>
                <div className="text-txt-secondary">{w.message}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {summary.readyForReview && onMarkReadyForReview ? (
        <button
          type="button"
          onClick={onMarkReadyForReview}
          className="mt-3 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          Mark as ready for review
        </button>
      ) : null}
    </section>
  );
}
