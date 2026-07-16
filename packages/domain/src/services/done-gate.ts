/**
 * Done Gate v1 — review-aware derivation that tells the user whether a feature
 * is ready to move to done, with a structured checklist.
 *
 * Source: agent_flow/implementation/v1/phases/phase-03-review-ledger-loop.md §6, §5.5
 *         agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.2.1 (v0 rules, kept)
 *
 * v1 upgrades v0 (warning-only) to a structured `result: 'pass' | 'warn' | 'blocked'`
 * plus a `checklist` of typed items. Open blocker/high findings now BLOCK done
 * (phase-03 §6 rule 1). Evidence trust_state != 'trusted' produces warn or
 * blocked per phase-03 §6 rules 3/4.
 *
 * v0 fields (warnings, readyForReview, blockingCount) are kept for backwards
 * compat with the P02C Feature Detail UI. P03C swaps the UI to read `checklist`
 * + `result`; the v0 fields can be deprecated in a follow-up.
 */
import type {
  AgentRun,
  Evidence,
  Feature,
  EvidenceTrustState,
  Todo,
  Review,
  ReviewFinding,
} from "@statehub/db";

/** One v0 gate warning. severity guides UI color (warn=amber, info=neutral). */
export interface DoneGateWarning {
  code:
    | "missing_test_result"
    | "untrusted_evidence"
    | "missing_evidence"
    | "open_todos"
    | "no_completed_runs"
    | "open_blocker_high_findings"
    | "review_not_approved";
  message: string;
  severity: "warn" | "info" | "blocked";
}

/** One v1 checklist item. status guides UI color (pass=green, warn=amber, blocked=red). */
export interface DoneGateChecklistItem {
  code:
    | "completed_runs"
    | "test_result_recorded"
    | "evidence_linked"
    | "evidence_trusted"
    | "no_open_blocker_high"
    | "review_verdict_approved"
    | "open_todos"
    | "risks_reviewed";
  label: string;
  status: "pass" | "warn" | "blocked";
  detail?: string;
}

export interface DoneGateSummary {
  featureId: string;
  /** v1: overall result. blocked > warn > pass. */
  result: "pass" | "warn" | "blocked";
  /** True if the UI should surface a "Ready for review" action. */
  readyForReview: boolean;
  /** v1: structured checklist. */
  checklist: DoneGateChecklistItem[];
  /** v0: warnings list (derived from checklist for backwards compat). */
  warnings: DoneGateWarning[];
  /** Convenience: count of warn-severity warnings (v0 compat). */
  blockingCount: number;
  /** The latest completed run, for the UI to link to. */
  latestCompletedRun: AgentRun | null;
  /** v1: latest review on the feature, for the UI. */
  latestReview: Review | null;
  /** v1: count of open blocker + high findings. */
  openBlockerHighCount: number;
}

/** Trust states that cannot independently support 'done' (phase-02 §6.2.1 rule 4). */
const NOT_TRUSTED: EvidenceTrustState[] = ["working_tree", "unknown", "untrusted"];
/** Trust states that BLOCK done (phase-03 §6 rule 3). */
const BLOCKED_TRUST: EvidenceTrustState[] = ["untrusted", "unknown"];
/** Trust states that allow ready_for_review but warn on done (phase-03 §6 rule 4). */
const WARN_TRUST: EvidenceTrustState[] = ["working_tree"];

export interface DoneGateInput {
  feature: Feature;
  agentRuns: AgentRun[];
  evidence: Evidence[];
  todos: Todo[];
  /** v1: reviews on the feature. */
  reviews?: Review[];
  /** v1: findings on the feature (across all reviews). */
  findings?: ReviewFinding[];
}

/**
 * Compute the Done Gate v1 summary for a feature. Pure function — no DB access,
 * no events. The caller assembles the inputs (typically via server-side queries).
 */
export function summarize(input: DoneGateInput): DoneGateSummary {
  const completedRuns = input.agentRuns
    .filter((r) => r.status === "completed")
    .sort((a, b) => b.finishedAt! - a.finishedAt!);
  const latest = completedRuns[0] ?? null;

  const reviews = (input.reviews ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const latestReview = reviews[0] ?? null;

  const findings = input.findings ?? [];
  const openBlockerHigh = findings.filter(
    (f) =>
      (f.severity === "blocker" || f.severity === "high") &&
      f.status !== "fixed" &&
      f.status !== "dismissed" &&
      f.status !== "wontfix",
  );
  const openBlockerHighCount = openBlockerHigh.length;

  const checklist: DoneGateChecklistItem[] = [];

  // 1. completed_runs
  if (completedRuns.length === 0) {
    checklist.push({
      code: "completed_runs",
      label: "At least one completed agent run",
      status: "warn",
      detail: "No completed agent runs yet.",
    });
  } else {
    checklist.push({
      code: "completed_runs",
      label: "At least one completed agent run",
      status: "pass",
      detail: `${completedRuns.length} completed run(s).`,
    });
  }

  // 2. test_result_recorded
  if (latest) {
    if (!latest.testResult || !latest.testResult.trim()) {
      checklist.push({
        code: "test_result_recorded",
        label: "Latest run recorded a test result",
        status: "warn",
      });
    } else {
      checklist.push({
        code: "test_result_recorded",
        label: "Latest run recorded a test result",
        status: "pass",
      });
    }
  }

  // 3 + 4. evidence_linked + evidence_trusted
  if (latest) {
    const runEvidence = input.evidence.filter((e) => e.agentRunId === latest.id);
    if (runEvidence.length === 0) {
      checklist.push({
        code: "evidence_linked",
        label: "Latest run has linked evidence",
        status: "warn",
      });
    } else {
      checklist.push({
        code: "evidence_linked",
        label: "Latest run has linked evidence",
        status: "pass",
        detail: `${runEvidence.length} evidence row(s).`,
      });

      const blockedTrust = runEvidence.filter((e) => BLOCKED_TRUST.includes(e.trustState));
      const warnTrust = runEvidence.filter((e) => WARN_TRUST.includes(e.trustState));
      const allTrusted = runEvidence.every((e) => e.trustState === "trusted");

      if (blockedTrust.length > 0) {
        checklist.push({
          code: "evidence_trusted",
          label: "Evidence is trusted (git-verified)",
          status: "blocked",
          detail: `${blockedTrust.length} evidence row(s) have trust_state untrusted/unknown — cannot satisfy required evidence.`,
        });
      } else if (warnTrust.length > 0) {
        checklist.push({
          code: "evidence_trusted",
          label: "Evidence is trusted (git-verified)",
          status: "warn",
          detail: `${warnTrust.length} evidence row(s) are working_tree — can ready_for_review but warn on done.`,
        });
      } else if (allTrusted) {
        checklist.push({
          code: "evidence_trusted",
          label: "Evidence is trusted (git-verified)",
          status: "pass",
        });
      }
    }
  }

  // 5. no_open_blocker_high — BLOCKED if any open blocker/high findings.
  if (openBlockerHighCount > 0) {
    checklist.push({
      code: "no_open_blocker_high",
      label: "No open blocker/high findings",
      status: "blocked",
      detail: `${openBlockerHighCount} open blocker/high finding(s).`,
    });
  } else {
    checklist.push({
      code: "no_open_blocker_high",
      label: "No open blocker/high findings",
      status: "pass",
    });
  }

  // 6. review_verdict_approved — warn (not blocked) if not approved.
  if (!latestReview) {
    checklist.push({
      code: "review_verdict_approved",
      label: "Latest review verdict approved",
      status: "warn",
      detail: "No review submitted yet.",
    });
  } else if (latestReview.verdict === "approved") {
    checklist.push({
      code: "review_verdict_approved",
      label: "Latest review verdict approved",
      status: "pass",
    });
  } else {
    checklist.push({
      code: "review_verdict_approved",
      label: "Latest review verdict approved",
      status: "warn",
      detail: `Latest verdict: ${latestReview.verdict}.`,
    });
  }

  // 7. open_todos — info/warn, not blocked.
  const openTodos = input.todos.filter(
    (t) => t.status !== "done" && t.status !== "cancelled",
  );
  if (openTodos.length > 0) {
    checklist.push({
      code: "open_todos",
      label: "No open todos",
      status: "warn",
      detail: `${openTodos.length} open todo(s).`,
    });
  } else {
    checklist.push({
      code: "open_todos",
      label: "No open todos",
      status: "pass",
    });
  }

  // 8. risks_reviewed — warn if the latest run has risks recorded.
  if (latest) {
    let risks: string[] = [];
    try {
      risks = JSON.parse(latest.risksJson ?? "[]") as string[];
    } catch {
      risks = [];
    }
    if (risks.length > 0) {
      checklist.push({
        code: "risks_reviewed",
        label: "Risks reviewed",
        status: "warn",
        detail: `${risks.length} risk(s) recorded on latest run — confirm they've been reviewed.`,
      });
    } else {
      checklist.push({
        code: "risks_reviewed",
        label: "Risks reviewed",
        status: "pass",
      });
    }
  }

  // Derive overall result.
  const hasBlocked = checklist.some((c) => c.status === "blocked");
  const hasWarn = checklist.some((c) => c.status === "warn");
  const result: DoneGateSummary["result"] = hasBlocked
    ? "blocked"
    : hasWarn
      ? "warn"
      : "pass";

  // Derive v0 warnings from the checklist for backwards compat.
  const warnings: DoneGateWarning[] = [];
  if (completedRuns.length === 0) {
    warnings.push({
      code: "no_completed_runs",
      message: "No completed agent runs yet — feature is not ready for review.",
      severity: "info",
    });
  }
  if (latest && (!latest.testResult || !latest.testResult.trim())) {
    warnings.push({
      code: "missing_test_result",
      message: "Latest agent run did not record a test result.",
      severity: "warn",
    });
  }
  if (latest) {
    const runEvidence = input.evidence.filter((e) => e.agentRunId === latest.id);
    if (runEvidence.length === 0) {
      warnings.push({
        code: "missing_evidence",
        message: "Latest agent run has no linked evidence.",
        severity: "warn",
      });
    } else {
      const notTrusted = runEvidence.filter((e) => NOT_TRUSTED.includes(e.trustState));
      const blockedTrust = runEvidence.filter((e) => BLOCKED_TRUST.includes(e.trustState));
      if (blockedTrust.length > 0) {
        warnings.push({
          code: "untrusted_evidence",
          message: `${blockedTrust.length} evidence row(s) have trust_state untrusted/unknown — cannot satisfy required evidence.`,
          severity: "blocked",
        });
      } else if (notTrusted.length > 0) {
        warnings.push({
          code: "untrusted_evidence",
          message: `${notTrusted.length} evidence row(s) are not git-verified (trust_state working_tree/unknown/untrusted).`,
          severity: "warn",
        });
      }
    }
  }
  if (openBlockerHighCount > 0) {
    warnings.push({
      code: "open_blocker_high_findings",
      message: `${openBlockerHighCount} open blocker/high finding(s) — feature cannot be done.`,
      severity: "blocked",
    });
  }
  if (latestReview && latestReview.verdict !== "approved") {
    warnings.push({
      code: "review_not_approved",
      message: `Latest review verdict is ${latestReview.verdict}.`,
      severity: "warn",
    });
  }
  if (openTodos.length > 0) {
    warnings.push({
      code: "open_todos",
      message: `${openTodos.length} open todo(s) on this feature.`,
      severity: "info",
    });
  }

  const blockingCount = warnings.filter((w) => w.severity === "warn" || w.severity === "blocked").length;
  // v0 compat: readyForReview is true only if no warn/blocked warnings remain.
  // (v1's `result` is more permissive — it distinguishes warn from blocked —
  // but readyForReview keeps the v0 semantics so the P02C UI doesn't change
  // behavior until P03C swaps to reading `result`.)
  const hasWarnOrBlocked = warnings.some(
    (w) => w.severity === "warn" || w.severity === "blocked",
  );
  const readyForReview =
    input.feature.status === "in_progress" &&
    completedRuns.length > 0 &&
    !hasWarnOrBlocked;

  return {
    featureId: input.feature.id,
    result,
    readyForReview,
    checklist,
    warnings,
    blockingCount,
    latestCompletedRun: latest,
    latestReview,
    openBlockerHighCount,
  };
}

export interface DoneGateService {
  summarize(input: DoneGateInput): DoneGateSummary;
}

export const doneGateService: DoneGateService = { summarize };
