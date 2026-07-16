import Link from "next/link";
import type { Review, ReviewFinding, Project, Feature, ReviewVerdict } from "@statehub/domain";
import { cn } from "@/lib/cn";

/**
 * Review Ledger table — one row per review.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p03c-ui-e2e-docs/plan.md §2.1
 *
 * Server component. The parent page assembles reviews + findings + lookup
 * maps and passes them in. Verdict filter is handled by the page via query
 * param; the table just renders what it gets.
 */
interface Props {
  workspaceId: string;
  reviews: Review[];
  findingsByReview: Map<string, ReviewFinding[]>;
  projectById: Map<string, Project>;
  featureById: Map<string, Feature>;
}

const VERDICT_STYLE: Record<ReviewVerdict, string> = {
  approved: "bg-success/15 text-success",
  needs_changes: "bg-warning/15 text-warning",
  blocked: "bg-danger/15 text-danger",
  informational: "bg-layer-2 text-txt-secondary",
};

function targetLabel(
  review: Review,
  projectById: Map<string, Project>,
  featureById: Map<string, Feature>,
): string {
  if (review.featureId) {
    const f = featureById.get(review.featureId);
    if (f) return f.name;
  }
  const p = projectById.get(review.projectId);
  return p ? `Project: ${p.name}` : review.projectId;
}

function relativeDate(ms: number): string {
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function ReviewLedgerTable({
  workspaceId,
  reviews,
  findingsByReview,
  projectById,
  featureById,
}: Props) {
  if (reviews.length === 0) {
    return (
      <div className="rounded-md border border-border-subtle bg-surface-1 p-8 text-center text-[13px] text-txt-tertiary">
        No reviews yet.
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-md border border-border-subtle bg-surface-1"
      data-testid="review-ledger-table"
    >
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead className="border-b border-border-subtle text-left text-[11px] uppercase tracking-wide text-txt-tertiary">
          <tr>
            <th className="border-b border-border-subtle px-3 py-2 font-medium">Verdict</th>
            <th className="border-b border-border-subtle px-3 py-2 font-medium">Target</th>
            <th className="border-b border-border-subtle px-3 py-2 font-medium">Reviewer</th>
            <th className="border-b border-border-subtle px-3 py-2 font-medium">Findings</th>
            <th className="border-b border-border-subtle px-3 py-2 font-medium">Blocker/High</th>
            <th className="border-b border-border-subtle px-3 py-2 font-medium">Linked Fixes</th>
            <th className="border-b border-border-subtle px-3 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map((r) => {
            const findings = findingsByReview.get(r.id) ?? [];
            const openBlockerHigh = findings.filter(
              (f) =>
                (f.severity === "blocker" || f.severity === "high") &&
                f.status !== "fixed" &&
                f.status !== "dismissed" &&
                f.status !== "wontfix",
            ).length;
            const linkedFixes = findings.filter((f) => f.linkedWorkItemId !== null).length;
            const target = targetLabel(r, projectById, featureById);
            const featureHref = r.featureId
              ? `/workspaces/${workspaceId}/projects/${r.projectId}/features/${r.featureId}`
              : null;

            return (
              <tr
                key={r.id}
                className="border-b border-border-subtle last:border-b-0 hover:bg-surface-2"
              >
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-xs px-1.5 py-0.5 text-[11px] font-medium capitalize",
                      VERDICT_STYLE[r.verdict],
                    )}
                  >
                    {r.verdict.replace("_", " ")}
                  </span>
                </td>
                <td className="max-w-[280px] truncate px-3 py-2 text-txt-primary">
                  {featureHref ? (
                    <Link href={featureHref} className="hover:underline">
                      {target}
                    </Link>
                  ) : (
                    <span>{target}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-txt-secondary">
                  <span className="text-txt-primary">{r.reviewer}</span>
                  {r.model ? (
                    <span className="ml-1.5 text-[11px] text-txt-tertiary">· {r.model}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-txt-secondary">{findings.length}</td>
                <td className="px-3 py-2">
                  {openBlockerHigh > 0 ? (
                    <span className="font-medium text-danger">{openBlockerHigh}</span>
                  ) : (
                    <span className="text-txt-tertiary">0</span>
                  )}
                </td>
                <td className="px-3 py-2 text-txt-secondary">{linkedFixes}</td>
                <td className="px-3 py-2 text-[12px] text-txt-tertiary">
                  {relativeDate(r.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
