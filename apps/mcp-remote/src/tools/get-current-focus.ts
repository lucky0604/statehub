/**
 * get_current_focus — what should the agent work on right now?
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4
 *         agent_flow/prd/v1.md §7.2.1
 *
 * Returns the highest-priority active project + its current feature + the
 * current-focus work item (derived deterministically by projectHealthService)
 * + open todos for that feature. Read-only, scope: read.
 *
 * goal / acceptance_criteria are not stored fields in P02A (deferred to a
 * later feature-richness phase); we surface the feature description as the
 * goal and an empty acceptance_criteria list, so the contract shape is stable
 * and forward-compatible.
 */
import { z } from "zod";
import {
  projectService,
  projectHealthService,
  featureService,
  todoService,
  type ActorContext,
} from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";

/** Zod raw shape — server.tool() takes a shape, not a z.object(). */
export const getCurrentFocusShape = {
  project_id: z.string().optional().describe("Optional: focus on a specific project. Defaults to the highest-priority active project."),
};

export const getCurrentFocusDescription =
  "Get the agent's current focus: the active project, its current feature, the current-focus work item, and open todos for that feature. Read-only.";

export interface CurrentFocusArgs {
  project_id?: string;
}

export interface CurrentFocusData {
  project: { id: string; name: string; slug: string };
  feature: { id: string; name: string; goal: string | null } | null;
  goal: string | null;
  acceptance_criteria: string[];
  open_todos: { id: string; title: string; status: string }[];
  current_focus: { work_item_id: string; title: string; identifier: string } | null;
}

export async function getCurrentFocus(
  db: DbClient,
  workspaceId: string,
  _actor: ActorContext,
  args: CurrentFocusArgs,
): Promise<ApiResult<CurrentFocusData>> {
  try {
    let projectId = args.project_id;
    if (!projectId) {
      // Pick the highest-priority active project (portfolio() orders by priority).
      const portfolio = await projectHealthService.portfolio(db, workspaceId);
      const projects = await projectService.list(db, workspaceId);
      const ordered = portfolio.byProject;
      const firstSummary = ordered[0];
      if (!firstSummary) {
        return {
          ok: false,
          error_code: "not_found",
          message: "no projects found in this workspace",
          retryable: false,
        };
      }
      projectId = firstSummary.projectId;
      const project = projects.find((p) => p.id === projectId)!;
      return buildFocus(db, workspaceId, project, firstSummary);
    }

    const projects = await projectService.list(db, workspaceId);
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      return { ok: false, error_code: "not_found", message: `project not found: ${projectId}`, retryable: false };
    }
    const summary = await projectHealthService.summarize(db, workspaceId, projectId);
    return buildFocus(db, workspaceId, project, summary);
  } catch (e) {
    return toToolError(e);
  }
}

async function buildFocus(
  db: DbClient,
  workspaceId: string,
  project: { id: string; name: string; slug: string },
  summary: { currentFocus: { workItemId: string; title: string; identifier: string } | null; currentFeature: { id: string; name: string } | null },
): Promise<ApiResult<CurrentFocusData>> {
  let feature: { id: string; name: string; goal: string | null } | null = null;
  let openTodos: { id: string; title: string; status: string }[] = [];

  if (summary.currentFeature) {
    const f = await featureService.get(db, workspaceId, summary.currentFeature.id);
    if (f) {
      feature = { id: f.id, name: f.name, goal: f.description ?? null };
      const todos = await todoService.listForFeature(db, workspaceId, f.id);
      openTodos = todos
        .filter((t) => t.status !== "done" && t.status !== "cancelled")
        .map((t) => ({ id: t.id, title: t.title, status: t.status }));
    }
  }

  return {
    ok: true,
    data: {
      project: { id: project.id, name: project.name, slug: project.slug },
      feature,
      goal: feature?.goal ?? null,
      acceptance_criteria: [],
      open_todos: openTodos,
      current_focus: summary.currentFocus
        ? {
            work_item_id: summary.currentFocus.workItemId,
            title: summary.currentFocus.title,
            identifier: summary.currentFocus.identifier,
          }
        : null,
    },
  };
}
