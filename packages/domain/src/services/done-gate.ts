/**
 * Done Gate v0 — warning-only derivation that tells the user a feature is NOT
 * done just because an agent ran, and what evidence is missing before the
 * feature can move to needs_review / done.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.2.1
 *         agent_flow/statehub-design-system.md §11.5 (Evidence Panel)
 *
 * Rules (warning-only; phase 03 adds review-aware blocking):
 *   1. A completed agent run does not mean a completed feature.
 *   2. Feature is "ready_for_review" only if: status='in_progress', ≥1 completed
 *      run, no missing-test-result warning, no missing-evidence warning.
 *   3. Missing test_result on the latest completed run → warn.
 *   4. Evidence with trust_state in {working_tree, unknown, untrusted} → warn
 *      (cannot independently support done).
 *   5. No evidence linked to the latest completed run → warn.
 *   6. Open todos on the feature → info.
 *   7. No completed runs at all → info.
 *
 * Done Gate v0 NEVER flips feature status. The UI moves the feature to
 * needs_review / done via the existing feature status API (P01A).
 */
import type {
  AgentRun,
  Evidence,
  Feature,
  EvidenceTrustState,
  Todo,
} from "@statehub/db";

/** One gate warning. severity guides UI color (warn=amber, info=neutral). */
export interface DoneGateWarning {
  code:
    | "missing_test_result"
    | "untrusted_evidence"
    | "missing_evidence"
    | "open_todos"
    | "no_completed_runs";
  message: string;
  severity: "warn" | "info";
}

export interface DoneGateSummary {
  featureId: string;
  /** True if the UI should surface a "Ready for review" action. */
  readyForReview: boolean;
  warnings: DoneGateWarning[];
  /** Convenience: count of warn-severity warnings. */
  blockingCount: number;
  /** The latest completed run, for the UI to link to. */
  latestCompletedRun: AgentRun | null;
}

/** Trust states that cannot independently support 'done' (phase-02 §6.2.1 rule 4). */
const NOT_TRUSTED: EvidenceTrustState[] = ["working_tree", "unknown", "untrusted"];

export interface DoneGateInput {
  feature: Feature;
  agentRuns: AgentRun[];
  evidence: Evidence[];
  todos: Todo[];
}

/**
 * Compute the Done Gate v0 summary for a feature. Pure function — no DB access,
 * no events. The caller assembles the inputs (typically via server-side queries).
 */
export function summarize(input: DoneGateInput): DoneGateSummary {
  const completedRuns = input.agentRuns
    .filter((r) => r.status === "completed")
    .sort((a, b) => b.finishedAt! - a.finishedAt!);
  const latest = completedRuns[0] ?? null;

  const warnings: DoneGateWarning[] = [];

  if (completedRuns.length === 0) {
    warnings.push({
      code: "no_completed_runs",
      message: "No completed agent runs yet — feature is not ready for review.",
      severity: "info",
    });
  }

  if (latest) {
    if (!latest.testResult || !latest.testResult.trim()) {
      warnings.push({
        code: "missing_test_result",
        message: "Latest agent run did not record a test result.",
        severity: "warn",
      });
    }

    const runEvidence = input.evidence.filter((e) => e.agentRunId === latest.id);
    if (runEvidence.length === 0) {
      warnings.push({
        code: "missing_evidence",
        message: "Latest agent run has no linked evidence.",
        severity: "warn",
      });
    } else {
      const untrusted = runEvidence.filter((e) => NOT_TRUSTED.includes(e.trustState));
      if (untrusted.length > 0) {
        warnings.push({
          code: "untrusted_evidence",
          message: `${untrusted.length} evidence row(s) are not git-verified (trust_state working_tree/unknown/untrusted).`,
          severity: "warn",
        });
      }
    }
  }

  const openTodos = input.todos.filter(
    (t) => t.status !== "done" && t.status !== "cancelled",
  );
  if (openTodos.length > 0) {
    warnings.push({
      code: "open_todos",
      message: `${openTodos.length} open todo(s) on this feature.`,
      severity: "info",
    });
  }

  const blockingCount = warnings.filter((w) => w.severity === "warn").length;
  const readyForReview =
    input.feature.status === "in_progress" &&
    completedRuns.length > 0 &&
    blockingCount === 0;

  return {
    featureId: input.feature.id,
    readyForReview,
    warnings,
    blockingCount,
    latestCompletedRun: latest,
  };
}

export interface DoneGateService {
  summarize(input: DoneGateInput): DoneGateSummary;
}

export const doneGateService: DoneGateService = { summarize };
