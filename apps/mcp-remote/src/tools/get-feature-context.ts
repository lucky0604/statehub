/**
 * get_feature_context — full background for a feature, for a coding agent.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4
 *         agent_flow/prd/v1.md §7.2.2
 *
 * Returns: feature, goal (description), acceptance_criteria (empty in P02A),
 * todos, recent agent runs, open findings (empty in P02A — reviews are P03).
 * Read-only, scope: read.
 */
import { z } from "zod";
import {
  featureService,
  todoService,
  agentRunService,
  evidenceService,
  mapAgentRun,
  mapTodo,
  mapEvidence,
  type ActorContext,
} from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";

export const getFeatureContextShape = {
  feature_id: z.string().describe("The feature to load context for."),
};

export const getFeatureContextDescription =
  "Load full context for a feature: goal, todos, recent agent runs, and linked evidence. Read-only.";

export interface FeatureContextArgs {
  feature_id: string;
}

export interface FeatureContextData {
  feature: { id: string; name: string; status: string; goal: string | null };
  goal: string | null;
  acceptance_criteria: string[];
  todos: { id: string; title: string; status: string; type: string }[];
  recent_agent_runs: {
    id: string;
    agent: string;
    run_type: string;
    status: string;
    summary: string | null;
    started_at: number;
    finished_at: number | null;
  }[];
  evidence: { id: string; title: string; trust_state: string; staleness_state: string }[];
  open_findings: never[];
}

export async function getFeatureContext(
  db: DbClient,
  workspaceId: string,
  _actor: ActorContext,
  args: FeatureContextArgs,
): Promise<ApiResult<FeatureContextData>> {
  try {
    const f = await featureService.get(db, workspaceId, args.feature_id);
    if (!f) {
      return { ok: false, error_code: "not_found", message: `feature not found: ${args.feature_id}`, retryable: false };
    }

    const [todos, runs, evidence] = await Promise.all([
      todoService.listForFeature(db, workspaceId, f.id),
      agentRunService.listForFeature(db, workspaceId, f.id, 10),
      evidenceService.listForFeature(db, workspaceId, f.id),
    ]);

    // Touch mappers so types are exercised even if inference strips them.
    void mapTodo;
    void mapAgentRun;
    void mapEvidence;

    return {
      ok: true,
      data: {
        feature: { id: f.id, name: f.name, status: f.status, goal: f.description ?? null },
        goal: f.description ?? null,
        acceptance_criteria: [],
        todos: todos.map((t) => ({ id: t.id, title: t.title, status: t.status, type: t.type })),
        recent_agent_runs: runs.map((r) => ({
          id: r.id,
          agent: r.agent,
          run_type: r.runType,
          status: r.status,
          summary: r.summary,
          started_at: r.startedAt,
          finished_at: r.finishedAt,
        })),
        evidence: evidence.map((e) => ({
          id: e.id,
          title: e.title,
          trust_state: e.trustState,
          staleness_state: e.stalenessState,
        })),
        open_findings: [],
      },
    };
  } catch (e) {
    return toToolError(e);
  }
}
