/**
 * start_agent_run_local — start_agent_run + git context from the local
 * sidecar (P04B).
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 *         agent_flow/implementation/v1/iterations/20260716-p04a-remote-repo-identity/plan.md §2.4
 *
 * Write tool, scope: write_agent_state. Idempotent on idempotency_key.
 * Superset of start_agent_run: also accepts repo_remote_url, git_branch,
 * base_sha, head_sha, dirty_state, which the agent_runs row persists. The
 * trust state is derived later on complete_agent_run_local.
 *
 * Returns { run_id, status: 'running' }.
 */
import { z } from "zod";
import { agentRunService, type ActorContext } from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";
import { withIdempotency } from "../idempotency-guard";

export const startAgentRunLocalShape = {
  project_id: z.string().describe("Project the run belongs to (must be in the token's workspace)."),
  feature_id: z.string().optional().describe("Optional feature the run targets."),
  work_item_id: z.string().optional().describe("Optional work item the run targets."),
  agent: z.string().describe("Agent name, e.g. 'opencode' or 'codex'."),
  run_type: z.string().describe("Run type, e.g. 'implement', 'investigate', 'fix'."),
  model: z.string().optional().describe("Model identifier, e.g. 'glm-5.2'."),
  repo_remote_url: z.string().optional().describe("Local repo remote URL (git@host:owner/repo or https)."),
  git_branch: z.string().optional().describe("Current git branch."),
  base_sha: z.string().optional().describe("Merge-base with the default branch."),
  head_sha: z.string().optional().describe("HEAD commit SHA."),
  dirty_state: z.boolean().optional().describe("True if the working tree is dirty."),
  idempotency_key: z.string().describe("Client-generated key; replaying returns the first run_id."),
};

export const startAgentRunLocalDescription =
  "Record that a coding agent is starting a run, with local git context attached. Superset of start_agent_run. Returns { run_id, status: 'running' }. Write (scope: write_agent_state). Idempotent on idempotency_key.";

export interface StartAgentRunLocalArgs {
  project_id: string;
  feature_id?: string;
  work_item_id?: string;
  agent: string;
  run_type: string;
  model?: string;
  repo_remote_url?: string;
  git_branch?: string;
  base_sha?: string;
  head_sha?: string;
  dirty_state?: boolean;
  idempotency_key: string;
}

export interface StartAgentRunLocalData {
  run_id: string;
  status: "running";
}

export async function startAgentRunLocal(
  db: DbClient,
  workspaceId: string,
  actor: ActorContext,
  args: StartAgentRunLocalArgs,
): Promise<ApiResult<StartAgentRunLocalData>> {
  const guarded = await withIdempotency<StartAgentRunLocalData>(
    db,
    workspaceId,
    args.idempotency_key,
    "start_agent_run_local",
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
          repoRemoteUrl: args.repo_remote_url,
          gitBranch: args.git_branch,
          baseSha: args.base_sha,
          headSha: args.head_sha,
          dirtyState: args.dirty_state,
        });
        return { ok: true, data: { run_id: run.id, status: "running" } };
      } catch (e) {
        return toToolError(e);
      }
    },
  );
  return guarded.response;
}
