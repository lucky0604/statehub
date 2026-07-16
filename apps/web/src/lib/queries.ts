/**
 * Server-side data access for pages/components.
 *
 * Calls the domain services directly (in-process) — faster than HTTP looping
 * back to the API routes for server-rendered pages. The API routes exist for
 * external/mutation callers; server components use these helpers.
 *
 * For P01A (solo dev), the "current workspace" is the first (only) workspace.
 * A real workspace switcher lands with multi-workspace support.
 */
import { cache } from "react";
import {
  workspaceService,
  projectService,
  workItemService,
  stateService,
  labelService,
  featureService,
  viewService,
  projectHealthService,
  agentRunService,
  evidenceService,
  todoService,
  tokenService,
  mcpSyncService,
  doneGateService,
  reviewService,
  type ListWorkItemsFilter,
  type PortfolioHealth,
  type ProjectHealthSummary,
  type McpSyncSummary,
  type DoneGateSummary,
  type AgentRun,
  type Evidence,
  type Todo,
  type Review,
  type ReviewFinding,
  type ReviewVerdict,
  type ListReviewsFilter,
  PORTFOLIO_PRIORITY_RANK,
} from "@statehub/domain";
import { db } from "./server";

/**
 * The current workspace for solo dev. Cached per-request via React `cache()`.
 * Returns null if no workspace exists yet (fresh install).
 */
export const getCurrentWorkspace = cache(async () => {
  const list = await workspaceService.list(db());
  return list[0] ?? null;
});

/** Ensure a workspace exists; return it. Throws if the DB is empty. */
export async function requireWorkspace() {
  const ws = await getCurrentWorkspace();
  if (!ws) {
    throw new Error("No workspace found. Run `pnpm db:seed` to create one.");
  }
  return ws;
}

export async function listProjects(workspaceId: string) {
  return projectService.list(db(), workspaceId);
}

export async function getProject(workspaceId: string, projectId: string) {
  return projectService.get(db(), workspaceId, projectId);
}

export async function listStates(workspaceId: string, projectId: string) {
  return stateService.list(db(), workspaceId, projectId);
}

export async function listLabels(workspaceId: string, projectId: string) {
  return labelService.list(db(), workspaceId, projectId);
}

export async function listFeatures(workspaceId: string, projectId: string) {
  return featureService.list(db(), workspaceId, projectId);
}

export async function listWorkItems(
  workspaceId: string,
  projectId: string,
  filter?: ListWorkItemsFilter,
) {
  return workItemService.list(db(), workspaceId, projectId, filter);
}

export async function getWorkItem(workspaceId: string, workItemId: string) {
  return workItemService.get(db(), workspaceId, workItemId);
}

export async function listViews(workspaceId: string, projectId: string) {
  return viewService.list(db(), workspaceId, projectId);
}

export async function listWorkItemLabelIds(workspaceId: string, workItemId: string) {
  return workItemService.listLabelIds(db(), workspaceId, workItemId);
}

export async function listWorkItemEvents(workspaceId: string, workItemId: string) {
  return workItemService.listEvents(db(), workspaceId, "work_item", workItemId);
}

/** Portfolio-level deterministic health (per-project summaries + at-risk + open high). */
export async function getPortfolioHealth(workspaceId: string): Promise<PortfolioHealth> {
  return projectHealthService.portfolio(db(), workspaceId);
}

/** Single-project deterministic health summary. */
export async function getProjectHealth(
  workspaceId: string,
  projectId: string,
): Promise<ProjectHealthSummary> {
  return projectHealthService.summarize(db(), workspaceId, projectId);
}

/** Recent agent runs across the workspace — for the right rail. */
export async function getRecentAgentRuns(workspaceId: string, limit = 3): Promise<AgentRun[]> {
  return agentRunService.listForWorkspace(db(), workspaceId, limit);
}

/** All agent runs for a feature — for the Feature Detail timeline. */
export async function listAgentRunsForFeature(
  workspaceId: string,
  featureId: string,
): Promise<AgentRun[]> {
  return agentRunService.listForFeature(db(), workspaceId, featureId, 50);
}

/** Evidence linked to a feature. */
export async function listEvidenceForFeature(
  workspaceId: string,
  featureId: string,
): Promise<Evidence[]> {
  return evidenceService.listForFeature(db(), workspaceId, featureId);
}

/** Todos linked to a feature. */
export async function listTodosForFeature(
  workspaceId: string,
  featureId: string,
): Promise<Todo[]> {
  return todoService.listForFeature(db(), workspaceId, featureId);
}

/** Done Gate v0 summary for a feature — derived, warning-only. */
export async function getDoneGate(
  workspaceId: string,
  featureId: string,
): Promise<DoneGateSummary> {
  const [feature, agentRuns, evidence, todos, reviews, findings] = await Promise.all([
    featureService.get(db(), workspaceId, featureId),
    listAgentRunsForFeature(workspaceId, featureId),
    listEvidenceForFeature(workspaceId, featureId),
    listTodosForFeature(workspaceId, featureId),
    reviewService.listForFeature(db(), workspaceId, featureId, 50),
    reviewService.listFindingsForFeature(db(), workspaceId, featureId),
  ]);
  if (!feature) {
    throw new Error(`feature not found: ${featureId}`);
  }
  return doneGateService.summarize({ feature, agentRuns, evidence, todos, reviews, findings });
}

/** Reviews across the workspace (or filtered by project/feature/verdict). */
export async function listReviews(
  workspaceId: string,
  filter: ListReviewsFilter = {},
): Promise<Review[]> {
  return reviewService.list(db(), workspaceId, filter);
}

/** Findings across all reviews on a feature — for Feature Detail findings section. */
export async function listFindingsForFeature(
  workspaceId: string,
  featureId: string,
): Promise<ReviewFinding[]> {
  return reviewService.listFindingsForFeature(db(), workspaceId, featureId);
}

/** Findings linked to + targeting a work item — for Work Item Peek. */
export async function listFindingsForWorkItem(
  workspaceId: string,
  workItemId: string,
): Promise<ReviewFinding[]> {
  return reviewService.listFindingsForWorkItem(db(), workspaceId, workItemId);
}

/** Reviews targeting a work item — for Work Item Peek. */
export async function listReviewsForWorkItem(
  workspaceId: string,
  workItemId: string,
): Promise<Review[]> {
  return reviewService.list(db(), workspaceId, { workItemId, limit: 20 });
}

export type { ReviewVerdict };

/** Derived MCP sync status — for the TopBar indicator. */
export async function getMcpSync(workspaceId: string): Promise<McpSyncSummary> {
  return mcpSyncService.derive(db(), workspaceId);
}

/** Non-revoked tokens — for the Settings page initial list. */
export async function listTokens(workspaceId: string) {
  return tokenService.list(db(), workspaceId);
}

export { PORTFOLIO_PRIORITY_RANK };
