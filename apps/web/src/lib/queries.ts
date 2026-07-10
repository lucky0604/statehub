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
  type ListWorkItemsFilter,
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
