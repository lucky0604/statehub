import type { WeeklyReview } from "@statehub/domain";

/**
 * Weekly Review View — renders saved weekly review summaries.
 *
 * Source: phase-05 §3.4 (weekly_review mode), §6.3 (UI).
 *
 * Each review's summary_json is a structured object with fields like
 * { completed, stalled, open_risks, next_week_focus, ... }. We render the
 * known fields and fall back to a JSON view for unknown shapes.
 */
interface Props {
  reviews: WeeklyReview[];
}

interface SummaryShape {
  completed?: number;
  stalled?: number;
  open_risks?: number | string[];
  next_week_focus?: string | string[];
  pause_recommendations?: string[];
  missing_evidence?: string[];
  [key: string]: unknown;
}

function formatWeek(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function WeeklyReviewView({ reviews }: Props) {
  if (reviews.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed border-border-subtle bg-surface-1 p-6 text-center text-[12px] text-txt-tertiary"
        data-testid="weekly-review-empty"
      >
        No weekly reviews saved yet. Run the AI PM in weekly_review mode to
        generate one.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="weekly-review-list">
      {reviews.map((r) => {
        let summary: SummaryShape = {};
        try {
          summary = JSON.parse(r.summaryJson) as SummaryShape;
        } catch {
          summary = {};
        }
        return (
          <article
            key={r.id}
            className="rounded-md border border-border-subtle bg-surface-1 p-4"
            data-testid="weekly-review-card"
          >
            <header className="flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-txt-primary">
                Week of {formatWeek(r.weekStart)} — {formatWeek(r.weekEnd)}
              </h3>
              <time className="text-[11px] text-txt-tertiary">
                Saved {formatWeek(r.createdAt)}
              </time>
            </header>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {typeof summary.completed === "number" ? (
                <Stat label="Completed" value={summary.completed} tone="success" />
              ) : null}
              {typeof summary.stalled === "number" ? (
                <Stat label="Stalled" value={summary.stalled} tone="warning" />
              ) : null}
              {typeof summary.open_risks === "number" ? (
                <Stat label="Open risks" value={summary.open_risks} tone="danger" />
              ) : null}
              {Array.isArray(summary.missing_evidence) ? (
                <Stat
                  label="Missing evidence"
                  value={summary.missing_evidence.length}
                  tone="warning"
                />
              ) : null}
            </div>

            {Array.isArray(summary.open_risks) && summary.open_risks.length > 0 ? (
              <Section title="Open risks">
                <ul className="flex flex-col gap-1">
                  {summary.open_risks.map((risk, i) => (
                    <li key={i} className="text-[12px] text-warning">
                      {risk}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {summary.next_week_focus ? (
              <Section title="Next week focus">
                {Array.isArray(summary.next_week_focus) ? (
                  <ul className="flex flex-col gap-1">
                    {summary.next_week_focus.map((f, i) => (
                      <li key={i} className="text-[12px] text-txt-secondary">
                        {f}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-txt-secondary">
                    {summary.next_week_focus}
                  </p>
                )}
              </Section>
            ) : null}

            {Array.isArray(summary.pause_recommendations) &&
            summary.pause_recommendations.length > 0 ? (
              <Section title="Pause recommendations">
                <ul className="flex flex-col gap-1">
                  {summary.pause_recommendations.map((p, i) => (
                    <li key={i} className="text-[12px] text-danger">
                      {p}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : "text-danger";
  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-2">
      <div className={`text-[18px] font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[11px] text-txt-tertiary">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
        {title}
      </h4>
      <div className="mt-1">{children}</div>
    </div>
  );
}
