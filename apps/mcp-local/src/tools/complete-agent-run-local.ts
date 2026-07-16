/**
 * complete_agent_run_local — local-side wrapper that delegates to the remote
 * complete_agent_run_local MCP tool, injecting git context from the local repo.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 *         agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2.6
 *
 * The agent supplies: run_id, summary, files_changed?, commands_run?,
 * test_result?, risks?, next_steps?, commit_sha?, idempotency_key.
 *
 * The sidecar injects: repo_remote_url, dirty_state, git_branch, base_sha,
 * head_sha. If commit_sha is not supplied, the sidecar uses head_sha from
 * getRepoContext.
 *
 * Returns { run_id, status: 'completed', evidence_trust_state }.
 */
import { z } from "zod";
import { type ApiResult, ok, err } from "@statehub/shared";
import type { ToolContext } from "../context.js";
import { getRepoContext } from "../git.js";
import { callMcpTool, RemoteError } from "../remote-client.js";

export const completeAgentRunLocalShape = {
  run_id: z.string().min(1).describe("The running agent run to complete."),
  summary: z.string().min(1).describe("Human-readable summary of what the agent did."),
  files_changed: z.array(z.string()).optional().describe("Paths of files changed by the run."),
  commands_run: z.array(z.string()).optional().describe("Commands executed by the agent."),
  test_result: z.string().optional().describe("Test result summary, e.g. 'all passing' or '2 failed'."),
  risks: z.array(z.string()).optional().describe("Risks the agent surfaced."),
  next_steps: z.array(z.string()).optional().describe("Suggested next steps."),
  commit_sha: z.string().optional().describe("Commit SHA. If omitted, the sidecar uses the local HEAD."),
  idempotency_key: z.string().min(1).describe("Client-generated key; replaying returns the first result."),
};

export const completeAgentRunLocalDescription =
  "Complete a running agent run with summary + local git context auto-attached. Delegates to the remote complete_agent_run_local MCP tool. Returns { run_id, status: 'completed', evidence_trust_state }. Write. Idempotent on idempotency_key.";

export interface CompleteAgentRunLocalArgs {
  run_id: string;
  summary: string;
  files_changed?: string[];
  commands_run?: string[];
  test_result?: string;
  risks?: string[];
  next_steps?: string[];
  commit_sha?: string;
  idempotency_key: string;
}

export interface CompleteAgentRunLocalData {
  run_id: string;
  status: "completed";
  evidence_trust_state: string;
}

interface RemoteCompleteAgentRunLocalData {
  run_id: string;
  status: "completed";
  evidence_trust_state: string;
}

export async function completeAgentRunLocal(
  ctx: ToolContext,
  args: CompleteAgentRunLocalArgs,
): Promise<ApiResult<CompleteAgentRunLocalData>> {
  if (!args.idempotency_key?.trim()) {
    return err("validation_error", "idempotency_key is required");
  }
  if (!args.run_id?.trim()) {
    return err("validation_error", "run_id is required");
  }
  if (!args.summary?.trim()) {
    return err("validation_error", "summary is required");
  }

  const repo = getRepoContext(ctx.cwd);

  const remoteArgs: Record<string, unknown> = {
    run_id: args.run_id,
    summary: args.summary,
    idempotency_key: args.idempotency_key,
    repo_remote_url: repo.repoRemoteUrl,
    dirty_state: repo.dirtyState,
    git_branch: repo.gitBranch,
    base_sha: repo.baseSha,
    head_sha: repo.headSha,
    commit_sha: args.commit_sha ?? repo.headSha ?? undefined,
  };
  if (args.files_changed) remoteArgs.files_changed = args.files_changed;
  if (args.commands_run) remoteArgs.commands_run = args.commands_run;
  if (args.test_result) remoteArgs.test_result = args.test_result;
  if (args.risks) remoteArgs.risks = args.risks;
  if (args.next_steps) remoteArgs.next_steps = args.next_steps;

  let res: ApiResult<RemoteCompleteAgentRunLocalData>;
  try {
    res = await callMcpTool<ApiResult<RemoteCompleteAgentRunLocalData>>(
      ctx.config,
      "complete_agent_run_local",
      remoteArgs,
    );
  } catch (e) {
    if (e instanceof RemoteError) {
      return err("external_source_error", e.message, { retryable: e.status >= 500 || e.status === 0 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return err("internal_error", `complete_agent_run_local failed: ${msg}`);
  }

  if (!res.ok) {
    return res;
  }
  return ok({
    run_id: res.data.run_id,
    status: "completed",
    evidence_trust_state: res.data.evidence_trust_state,
  });
}
