/**
 * Context packet builder — assembles a bounded snapshot of StateHub data
 * for the AI PM.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md §4
 *
 * The packet is what the AI PM sees. It is bounded:
 *   - current project first (if provided)
 *   - current feature first (if provided)
 *   - open + high-risk items first
 *   - recent 14–30 days of activity
 *   - summaries over raw logs
 *
 * The builder takes already-loaded domain entities (the caller is
 * responsible for fetching them — keeping the builder pure makes it
 * testable without a DB). The aiPmService orchestrates the fetches.
 *
 * Missing-data warnings are emitted explicitly so the AI PM cannot sound
 * confidently about something it has no data on (phase doc §8 rule 6).
 */
import type {
  Project,
  Feature,
  WorkItem,
  Review,
  ReviewFinding,
  AgentRun,
  Evidence,
  Todo,
  Cycle,
} from "@statehub/db";
import type { AIPmMode } from "./answer-schema";

export interface ContextPacket {
  mode: AIPmMode;
  generated_at: number;
  workspace: { id: string; slug: string; name: string };
  current_project: Project | null;
  current_feature: Feature | null;
  projects: Array<Pick<Project, "id" | "slug" | "name" | "status" | "portfolioPriority">>;
  features: Array<
    Pick<
      Feature,
      "id" | "name" | "status" | "projectId" | "createdAt" | "updatedAt"
    >
  >;
  work_items: Array<
    Pick<
      WorkItem,
      | "id"
      | "title"
      | "type"
      | "priority"
      | "stateId"
      | "featureId"
      | "projectId"
      | "sequenceId"
      | "projectIdentifier"
    >
  >;
  open_findings: Array<
    Pick<ReviewFinding, "id" | "severity" | "title" | "reviewId" | "status">
  >;
  recent_reviews: Array<Pick<Review, "id" | "verdict" | "summary" | "createdAt">>;
  recent_agent_runs: Array<
    Pick<AgentRun, "id" | "status" | "agent" | "startedAt" | "finishedAt">
  >;
  recent_evidence: Array<
    Pick<
      Evidence,
      | "id"
      | "evidenceType"
      | "title"
      | "trustState"
      | "stalenessState"
      | "createdAt"
    >
  >;
  open_todos: Array<Pick<Todo, "id" | "title" | "status" | "featureId">>;
  cycles: Array<Pick<Cycle, "id" | "name" | "status" | "startDate" | "endDate">>;
  missing_data_warnings: string[];
}

export interface BuildContextInput {
  mode: AIPmMode;
  workspace: { id: string; slug: string; name: string };
  currentProject?: Project | null;
  currentFeature?: Feature | null;
  projects: Array<Pick<Project, "id" | "slug" | "name" | "status" | "portfolioPriority">>;
  features: Array<
    Pick<Feature, "id" | "name" | "status" | "projectId" | "createdAt" | "updatedAt">
  >;
  workItems: Array<
    Pick<
      WorkItem,
      | "id"
      | "title"
      | "type"
      | "priority"
      | "stateId"
      | "featureId"
      | "projectId"
      | "sequenceId"
      | "projectIdentifier"
    >
  >;
  openFindings: Array<
    Pick<ReviewFinding, "id" | "severity" | "title" | "reviewId" | "status">
  >;
  recentReviews: Array<Pick<Review, "id" | "verdict" | "summary" | "createdAt">>;
  recentAgentRuns: Array<
    Pick<AgentRun, "id" | "status" | "agent" | "startedAt" | "finishedAt">
  >;
  recentEvidence: Array<
    Pick<
      Evidence,
      | "id"
      | "evidenceType"
      | "title"
      | "trustState"
      | "stalenessState"
      | "createdAt"
    >
  >;
  openTodos: Array<Pick<Todo, "id" | "title" | "status" | "featureId">>;
  cycles: Array<Pick<Cycle, "id" | "name" | "status" | "startDate" | "endDate">>;
  /** Override the generated_at timestamp (tests). Defaults to Date.now(). */
  now?: number;
}

/**
 * Build a bounded ContextPacket. Reorders so the current project/feature
 * comes first; surfaces missing-data warnings explicitly.
 *
 * The packet is meant to be JSON-serialized and handed to the AI provider
 * as part of the user prompt. Keep it lean — summaries, not raw logs.
 */
export function buildContextPacket(input: BuildContextInput): ContextPacket {
  const now = input.now ?? Date.now();
  const missing: string[] = [];

  if (input.projects.length === 0) {
    missing.push("workspace has no projects");
  }
  if (input.features.length === 0) {
    missing.push("workspace has no features");
  }
  if (input.workItems.length === 0) {
    missing.push("workspace has no work items");
  }
  if (input.openFindings.length === 0 && input.mode === "review_triage") {
    missing.push("no open review findings to triage");
  }
  if (input.recentEvidence.length === 0) {
    missing.push("no evidence recorded yet — trust state cannot be derived");
  }
  if (input.currentFeature) {
    const featureWorkItems = input.workItems.filter(
      (wi) => wi.featureId === input.currentFeature!.id,
    );
    if (featureWorkItems.length === 0) {
      missing.push(`current feature ${input.currentFeature.id} has no work items`);
    }
  }

  // Reorder: current project's items first, then by recency.
  const currentProjectId = input.currentProject?.id ?? null;
  const currentFeatureId = input.currentFeature?.id ?? null;

  const featuresSorted = [...input.features].sort((a, b) => {
    if (currentProjectId) {
      const ap = a.projectId === currentProjectId ? 0 : 1;
      const bp = b.projectId === currentProjectId ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    if (currentFeatureId) {
      const af = a.id === currentFeatureId ? 0 : 1;
      const bf = b.id === currentFeatureId ? 0 : 1;
      if (af !== bf) return af - bf;
    }
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });

  const workItemsSorted = [...input.workItems].sort((a, b) => {
    if (currentFeatureId) {
      const af = a.featureId === currentFeatureId ? 0 : 1;
      const bf = b.featureId === currentFeatureId ? 0 : 1;
      if (af !== bf) return af - bf;
    }
    if (currentProjectId) {
      const ap = a.projectId === currentProjectId ? 0 : 1;
      const bp = b.projectId === currentProjectId ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    // High-priority open items next.
    const pri = (p: string | null) =>
      p === "high" ? 0 : p === "medium" ? 1 : p === "low" ? 2 : 3;
    return pri(a.priority) - pri(b.priority);
  });

  return {
    mode: input.mode,
    generated_at: now,
    workspace: input.workspace,
    current_project: input.currentProject ?? null,
    current_feature: input.currentFeature ?? null,
    projects: input.projects,
    features: featuresSorted,
    work_items: workItemsSorted,
    open_findings: input.openFindings,
    recent_reviews: input.recentReviews,
    recent_agent_runs: input.recentAgentRuns,
    recent_evidence: input.recentEvidence,
    open_todos: input.openTodos,
    cycles: input.cycles,
    missing_data_warnings: missing,
  };
}
