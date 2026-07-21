"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FeatureStatus } from "@statehub/domain";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

/**
 * Feature status control — surfaces the allowed next transitions as buttons.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.2.1
 *
 * Done Gate v0 rule 5: feature status can only be changed from the UI, never
 * through MCP. This button is the only such path. When the gate says
 * `readyForReview`, the "Needs review" button is highlighted as the
 * recommended next step.
 */
interface Props {
  workspaceId: string;
  projectId: string;
  featureId: string;
  currentStatus: FeatureStatus;
  readyForReview: boolean;
}

// Match packages/domain/src/services/feature.ts ALLOWED_TRANSITIONS.
const NEXT: Record<FeatureStatus, FeatureStatus[]> = {
  backlog: ["planned"],
  planned: ["in_progress", "backlog"],
  in_progress: ["needs_review", "needs_changes", "done", "planned"],
  needs_review: ["needs_changes", "done", "in_progress"],
  needs_changes: ["in_progress"],
  done: ["reopened"],
  reopened: ["in_progress", "done"],
};

const LABEL: Record<FeatureStatus, string> = {
  backlog: "Backlog",
  planned: "Planned",
  in_progress: "In progress",
  needs_review: "Needs review",
  needs_changes: "Needs changes",
  done: "Done",
  reopened: "Reopened",
};

export function FeatureStatusButton({
  workspaceId,
  projectId,
  featureId,
  currentStatus,
  readyForReview,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<FeatureStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(next: FeatureStatus) {
    if (busy) return;
    setBusy(next);
    setError(null);
    try {
      await api.post(
        `/api/workspaces/${workspaceId}/projects/${projectId}/features/${featureId}/status`,
        { status: next },
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to change status");
    } finally {
      setBusy(null);
    }
  }

  const options = NEXT[currentStatus] ?? [];

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        {options.length === 0 ? (
          <span className="text-[11px] text-txt-tertiary italic">No transitions available</span>
        ) : (
          options.map((s) => {
            const recommended = readyForReview && s === "needs_review";
            return (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={recommended ? "primary" : "outline"}
                onClick={() => void changeStatus(s)}
                disabled={busy !== null}
              >
                {recommended ? "Mark as ready for review" : `→ ${LABEL[s]}`}
              </Button>
            );
          })
        )}
      </div>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
