/**
 * start_agent_run_local — local-side wrapper that delegates to the remote
 * start_agent_run_local MCP tool, injecting git context from the local repo.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 *         agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2.6
 *
 * The agent supplies: agent, run_type, model?, feature_id?, work_item_id?,
 * idempotency_key. The sidecar injects: project_id (from config), repo_remote_url,
 * git_branch, base_sha, head_sha, dirty_state (from getRepoContext).
 *
 * The remote tool is idempotent on idempotency_key, so a network retry with the
 * same key returns the same run_id.
 */
import { z } from "zod";
import { type ApiResult, ok, err } from "@statehub/shared";
import type { ToolContext } from "../context.js";
import { getRepoContext } from "../git.js";
import { callMcpTool, RemoteError } from "../remote-client.js";

export const startAgentRunLocalShape = {
  feature_id: z.string().optional().describe("Optional feature the run targets."),
  work_item_id: z.string().optional().describe("Optional work item the run targets."),
  agent: z.string().describe("Agent name, e.g. 'opencode' or 'codex'."),
  run_type: z.string().describe("Run type, e.g. 'implement', 'investigate', 'fix'."),
  model: z.string().optional().describe("Model identifier, e.g. 'glm-5.2'."),
  idempotency_key: z.string().min(1).describe("Client-generated key; replaying returns the first run_id."),
};

export const startAgentRunLocalDescription =
  "Record that a coding agent is starting a run, with local git context auto-attached. Delegates to the remote start_agent_run_local MCP tool. Returns { run_id, status: 'running' }. Write. Idempotent on idempotency_key.";

export interface StartAgentRunLocalArgs {
  feature_id?: string;
  work_item_id?: string;
  agent: string;
  run_type: string;
  model?: string;
  idempotency_key: string;
}

export interface StartAgentRunLocalData {
  run_id: string;
  status: "running";
}

interface RemoteStartAgentRunLocalData {
  run_id: string;
  status: "running";
}

export async function startAgentRunLocal(
  ctx: ToolContext,
  args: StartAgentRunLocalArgs,
): Promise<ApiResult<StartAgentRunLocalData>> {
  if (!args.idempotency_key?.trim()) {
    return err("validation_error", "idempotency_key is required");
  }
  if (!args.agent?.trim()) {
    return err("validation_error", "agent is required");
  }
  if (!args.run_type?.trim()) {
    return err("validation_error", "run_type is required");
  }

  const repo = getRepoContext(ctx.cwd);

  const remoteArgs: Record<string, unknown> = {
    project_id: ctx.resolved.ids.projectId,
    agent: args.agent,
    run_type: args.run_type,
    idempotency_key: args.idempotency_key,
    repo_remote_url: repo.repoRemoteUrl,
    git_branch: repo.gitBranch,
    base_sha: repo.baseSha,
    head_sha: repo.headSha,
    dirty_state: repo.dirtyState,
  };
  if (args.feature_id) remoteArgs.feature_id = args.feature_id;
  if (args.work_item_id) remoteArgs.work_item_id = args.work_item_id;
  if (args.model) remoteArgs.model = args.model;

  let res: ApiResult<RemoteStartAgentRunLocalData>;
  try {
    res = await callMcpTool<ApiResult<RemoteStartAgentRunLocalData>>(
      ctx.config,
      "start_agent_run_local",
      remoteArgs,
    );
  } catch (e) {
    if (e instanceof RemoteError) {
      return err("external_source_error", e.message, { retryable: e.status >= 500 || e.status === 0 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return err("internal_error", `start_agent_run_local failed: ${msg}`);
  }

  if (!res.ok) {
    return res;
  }
  return ok({ run_id: res.data.run_id, status: "running" });
}
