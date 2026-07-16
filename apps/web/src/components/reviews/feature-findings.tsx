import type { ReviewFinding, FindingSeverity, WorkItem } from "@statehub/domain";
import { FindingCard } from "./finding-card";

/**
 * Feature Findings section — groups all findings across all reviews on a
 * feature by severity (blocker → high → medium → low → nit).
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p03c-ui-e2e-docs/plan.md §0.3
 *
 * Server component. The parent page assembles findings + a workItemById map
 * (for resolving linked fix identifiers) and passes them in.
 */
interface Props {
  workspaceId: string;
  projectId: string;
  findings: ReviewFinding[];
  workItemById: Map<string, WorkItem>;
}

const SEVERITY_ORDER: FindingSeverity[] = ["blocker", "high", "medium", "low", "nit"];

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  blocker: "Blocker",
  high: "High",
  medium: "Medium",
  low: "Low",
  nit: "Nit",
};

export function FeatureFindings({ workspaceId, projectId, findings, workItemById }: Props) {
  if (findings.length === 0) {
    return null;
  }

  const groups = new Map<FindingSeverity, ReviewFinding[]>();
  for (const f of findings) {
    const list = groups.get(f.severity) ?? [];
    list.push(f);
    groups.set(f.severity, list);
  }

  return (
    <section
      className="rounded-md border border-border-subtle bg-surface-1 p-3"
      aria-label="Findings"
      data-testid="feature-findings"
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
        Findings · {findings.length}
      </div>
      <div className="mt-2 space-y-3">
        {SEVERITY_ORDER.filter((s) => groups.has(s)).map((s) => {
          const list = groups.get(s) ?? [];
          return (
            <div key={s}>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-txt-secondary">
                {SEVERITY_LABEL[s]} · {list.length}
              </div>
              <div className="space-y-2">
                {list.map((f) => {
                  const linked = f.linkedWorkItemId
                    ? workItemById.get(f.linkedWorkItemId)
                    : undefined;
                  return (
                    <FindingCard
                      key={f.id}
                      workspaceId={workspaceId}
                      projectId={projectId}
                      reviewId={f.reviewId}
                      finding={f}
                      linkedIdentifier={
                        linked ? `${linked.projectIdentifier}-${linked.sequenceId}` : undefined
                      }
                      linkedHref={
                        linked
                          ? `/workspaces/${workspaceId}/projects/${linked.projectId}?peek=${linked.id}`
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
