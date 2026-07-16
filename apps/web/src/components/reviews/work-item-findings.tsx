"use client";

import { useEffect, useState } from "react";
import type { ReviewFinding } from "@statehub/domain";
import { api, ApiError } from "@/lib/api-client";
import { FindingCard } from "./finding-card";

/**
 * Work Item Findings — client component for the Work Item Peek.
 *
 * Fetches findings linked to + targeting the work item via the work-items
 * findings API, then renders FindingCards grouped by linked vs targeting.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p03c-ui-e2e-docs/plan.md §0.5
 */
interface Props {
  workspaceId: string;
  projectId: string;
  workItemId: string;
}

interface FindingsResponse {
  findings: ReviewFinding[];
  linkedWorkItems: Array<{ id: string; identifier: string; projectId: string }>;
}

export function WorkItemFindings({ workspaceId, projectId, workItemId }: Props) {
  const [data, setData] = useState<FindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<FindingsResponse>(
        `/api/workspaces/${workspaceId}/projects/${projectId}/work-items/${workItemId}/findings`,
      )
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : "Failed to load findings");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, projectId, workItemId]);

  if (loading) {
    return (
      <div className="text-[12px] text-txt-tertiary" data-testid="work-item-findings-loading">
        Loading findings…
      </div>
    );
  }
  if (error) {
    return <div className="text-[12px] text-danger">{error}</div>;
  }
  if (!data || data.findings.length === 0) {
    return null;
  }

  const linkedById = new Map(data.linkedWorkItems.map((w) => [w.id, w] as const));
  const linked = data.findings.filter((f) => f.linkedWorkItemId === workItemId);
  const targeting = data.findings.filter((f) => f.workItemId === workItemId);
  // Findings linked to OTHER work items (rare in the peek context, but possible
  // if the same finding is re-linked). Show them in the targeting group.
  const otherLinked = data.findings.filter(
    (f) => f.linkedWorkItemId !== null && f.linkedWorkItemId !== workItemId && f.workItemId !== workItemId,
  );

  return (
    <div className="space-y-3" data-testid="work-item-findings">
      {targeting.length > 0 || otherLinked.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-txt-tertiary">
            Findings targeting this item · {targeting.length + otherLinked.length}
          </div>
          <div className="space-y-2">
            {targeting.map((f) => (
              <FindingCard
                key={f.id}
                workspaceId={workspaceId}
                projectId={projectId}
                reviewId={f.reviewId}
                finding={f}
              />
            ))}
            {otherLinked.map((f) => {
              const linkedWi = f.linkedWorkItemId ? linkedById.get(f.linkedWorkItemId) : undefined;
              return (
                <FindingCard
                  key={f.id}
                  workspaceId={workspaceId}
                  projectId={projectId}
                  reviewId={f.reviewId}
                  finding={f}
                  linkedIdentifier={linkedWi?.identifier}
                  linkedHref={
                    linkedWi
                      ? `/workspaces/${workspaceId}/projects/${linkedWi.projectId}?peek=${linkedWi.id}`
                      : undefined
                  }
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {linked.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-txt-tertiary">
            Findings linked as fix · {linked.length}
          </div>
          <div className="space-y-2">
            {linked.map((f) => (
              <FindingCard
                key={f.id}
                workspaceId={workspaceId}
                projectId={projectId}
                reviewId={f.reviewId}
                finding={f}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
