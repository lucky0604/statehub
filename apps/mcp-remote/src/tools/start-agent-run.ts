/**
 * start_agent_run — record that an agent begins executing a task.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4
 *         agent_flow/prd/v1.md §7.2.5
 *
 * Write tool, scope: write_agent_state. Idempotent on idempotency_key.
 * Returns { run_id, status: 'running' }.
 */
import { z } from "zod";
import { agentRunService, type ActorContext } from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";
import { withIdempotency } from "../idempotency-guard";

export const startAgentRunShape = {
  project_id: z.string().describe("Project the run belongs to (must be in the token's workspace)."),
  feature_id: z.string().optional().describe("Optional feature the run targets."),
  work_item_id: z.string().optional().describe("Optional work item the run targets."),
  agent: z.string().describe("Agent name, e.g. 'opencode' or 'codex'."),
  run_type: z.string().describe("Run type, e.g. 'implement', 'investigate', 'fix'."),
  model: z.string().optional().describe("Model identifier, e.g. 'glm-5.2'."),
  idempotency_key: z.string().describe("Client-generated key; replaying with the same key returns the first run_id."),
};

export const startAgentRunDescription =
  "Record that a coding agent is starting a run. Returns { run_id, status: 'running' }. Write (scope: write_agent_state). Idempotent on idempotency_key.";

export interface StartAgentRunArgs {
  project_id: string;
  feature_id?: string;
  work_item_id?: string;
  agent: string;
  run_type: string;
  model?: string;
  idempotency_key: string;
}

export interface StartAgentRunData {
  run_id: string;
  status: "running";
}

export async function startAgentRun(
  db: DbClient,
  workspaceId: string,
  actor: ActorContext,
  args: StartAgentRunArgs,
): Promise<ApiResult<StartAgentRunData>> {
  const guarded = await withIdempotency<StartAgentRunData>(
    db,
    workspaceId,
    args.idempotency_key,
    "start_agent_run",
    args,
    async () => {
      try {
        const run = await agentRunService.start(db, actor, workspaceId, {
          projectId: args.project_id,
          featureId: args.feature_id,
          workItemId: args.work_item_id,
          agent: args.agent,
          model: args.model,
          runType: args.run_type,
        });
        return { ok: true, data: { run_id: run.id, status: "running" } };
      } catch (e) {
        return toToolError(e);
      }
    },
  );
  return guarded.response;
}
