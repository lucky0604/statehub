import type { DoneGateSummary } from "@statehub/domain";
import { cn } from "@/lib/cn";

/**
 * Done Gate v1 checklist — structured pass/warn/blocked panel.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p03c-ui-e2e-docs/plan.md §2.3
 *
 * Replaces the v0 warning list (DoneGateWarning). Kept alongside v0 in P03C
 * per risk #2 mitigation — P02C e2e keeps using v0; P03C e2e uses this one.
 * Deprecation of v0 lands in a follow-up.
 */
interface Props {
  summary: DoneGateSummary;
}

const RESULT_STYLE: Record<DoneGateSummary["result"], string> = {
  pass: "border-success/40 bg-success/5 text-success",
  warn: "border-warning/40 bg-warning/5 text-warning",
  blocked: "border-danger/40 bg-danger/5 text-danger",
};

const DOT_STYLE: Record<"pass" | "warn" | "blocked", string> = {
  pass: "bg-success",
  warn: "bg-warning",
  blocked: "bg-danger",
};

export function DoneGateChecklist({ summary }: Props) {
  return (
    <section
      className={cn("rounded-md border p-3", RESULT_STYLE[summary.result])}
      aria-label="Done Gate Checklist"
      data-testid="done-gate-checklist"
      data-result={summary.result}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Done Gate
        </div>
        <span
          className={cn(
            "rounded-xs px-1.5 py-0.5 text-[10px] font-medium uppercase",
            RESULT_STYLE[summary.result],
          )}
        >
          {summary.result}
        </span>
      </div>

      <ul className="mt-2 space-y-1.5">
        {summary.checklist.map((item) => (
          <li key={item.code} className="flex items-start gap-2 text-[12px]">
            <span
              className={cn(
                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                DOT_STYLE[item.status],
              )}
              aria-label={`status: ${item.status}`}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-txt-primary">{item.label}</div>
              {item.detail ? (
                <div className="text-txt-secondary">{item.detail}</div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
