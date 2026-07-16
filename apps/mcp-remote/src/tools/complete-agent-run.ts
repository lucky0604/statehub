/**
 * complete_agent_run — record that an agent finished, with evidence.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4
 *         agent_flow/prd/v1.md §7.2.6
 *
 * Write tool, scope: write_agent_state. Idempotent on idempotency_key.
 * Can only complete a 'running' run (else conflict). The domain service also
 * creates an evidence row (trust_state 'working_tree') in the same batch.
 * Returns { run_id, status: 'completed' }.
 */
import { z } from "zod";
import { agentRunService, type ActorContext } from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "../errors";
import { withIdempotency } from "../idempotency-guard";

export const completeAgentRunShape = {
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
  idempotency_key: z.string().describe("Client-generated key; replaying returns the first result."),
};

export const completeAgentRunDescription =
  "Complete a running agent run with summary, files, commands, test result, risks, and next steps. Records an evidence row (trust_state 'working_tree'). Returns { run_id, status: 'completed' }. Write (scope: write_agent_state). Idempotent. Only completes a 'running' run.";

export interface CompleteAgentRunArgs {
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
  idempotency_key: string;
}

export interface CompleteAgentRunData {
  run_id: string;
  status: "completed";
}

export async function completeAgentRun(
  db: DbClient,
  workspaceId: string,
  actor: ActorContext,
  args: CompleteAgentRunArgs,
): Promise<ApiResult<CompleteAgentRunData>> {
  const guarded = await withIdempotency<CompleteAgentRunData>(
    db,
    workspaceId,
    args.idempotency_key,
    "complete_agent_run",
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
        });
        return { ok: true, data: { run_id: run.id, status: "completed" } };
      } catch (e) {
        return toToolError(e);
      }
    },
  );
  return guarded.response;
}
