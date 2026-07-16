/**
 * complete_agent_run_local — complete_agent_run + git context from the local
 * sidecar (P04B). Derives evidence_trust_state from repo identity + dirty
 * state on completion.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 *         agent_flow/implementation/v1/iterations/20260716-p04a-remote-repo-identity/plan.md §2.4
 *
 * Write tool, scope: write_agent_state. Idempotent on idempotency_key.
 * Superset of complete_agent_run: also accepts repo_remote_url and
 * dirty_state. The domain service derives the evidence trust state:
 *   matched + clean → trusted
 *   matched + dirty  → working_tree
 *   unknown          → working_tree (unchanged from P02A default)
 *
 * Returns { run_id, status: 'completed', evidence_trust_state }.
 */
import { z } from "zod";
import { agentRunService, type ActorContext } from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";
import { withIdempotency } from "../idempotency-guard";

export const completeAgentRunLocalShape = {
  run_id: z.string().describe("The running agent run to complete."),
  summary: z.string().describe("Human-readable summary of what the agent did."),
  files_changed: z.array(z.string()).optional().describe("Paths of files changed by the run."),
  commands_run: z.array(z.string()).optional().describe("Commands executed by the agent."),
  test_result: z.string().optional().describe("Test result summary, e.g. 'all passing' or '2 failed'."),
  risks: z.array(z.string()).optional().describe("Risks the agent surfaced."),
  next_steps: z.array(z.string()).optional().describe("Suggested next steps."),
  commit_sha: z.string().optional(),
  base_sha: z.string().optional(),
  head_sha: z.string().optional(),
  git_branch: z.string().optional(),
  repo_remote_url: z.string().optional().describe("Local repo remote URL. If supplied and matches the project, evidence is trusted."),
  dirty_state: z.boolean().optional().describe("True if the working tree is dirty."),
  idempotency_key: z.string().describe("Client-generated key; replaying returns the first result."),
};

export const completeAgentRunLocalDescription =
  "Complete a running agent run with summary + local git context. Derives evidence trust state from repo identity + dirty state. Returns { run_id, status: 'completed', evidence_trust_state }. Write (scope: write_agent_state). Idempotent.";

export interface CompleteAgentRunLocalArgs {
  run_id: string;
  summary: string;
  files_changed?: string[];
  commands_run?: string[];
  test_result?: string;
  risks?: string[];
  next_steps?: string[];
  commit_sha?: string;
  base_sha?: string;
  head_sha?: string;
  git_branch?: string;
  repo_remote_url?: string;
  dirty_state?: boolean;
  idempotency_key: string;
}

export interface CompleteAgentRunLocalData {
  run_id: string;
  status: "completed";
  evidence_trust_state: string;
}

export async function completeAgentRunLocal(
  db: DbClient,
  workspaceId: string,
  actor: ActorContext,
  args: CompleteAgentRunLocalArgs,
): Promise<ApiResult<CompleteAgentRunLocalData>> {
  const guarded = await withIdempotency<CompleteAgentRunLocalData>(
    db,
    workspaceId,
    args.idempotency_key,
    "complete_agent_run_local",
    args,
    async () => {
      try {
        const run = await agentRunService.complete(db, actor, workspaceId, args.run_id, {
          summary: args.summary,
          filesChanged: args.files_changed,
          commandsRun: args.commands_run,
          testResult: args.test_result,
          risks: args.risks,
          nextSteps: args.next_steps,
          commitSha: args.commit_sha,
          baseSha: args.base_sha,
          headSha: args.head_sha,
          gitBranch: args.git_branch,
          repoRemoteUrl: args.repo_remote_url,
          dirtyState: args.dirty_state,
        });
        return {
          ok: true,
          data: { run_id: run.id, status: "completed", evidence_trust_state: run.evidenceTrustState },
        };
      } catch (e) {
        return toToolError(e);
      }
    },
  );
  return guarded.response;
}
