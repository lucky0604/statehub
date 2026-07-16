/**
 * sync_evidence — POST evidence + current git context to Remote StateHub.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §5, §6
 *         agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2.5
 *
 * The sidecar injects the current git context (branch, shas, dirty_state,
 * changed_files, untracked_files) into payload_json before sending. The remote
 * localEvidenceService.ingest then derives trust_state + staleness_state from
 * repo identity + dirty state.
 *
 * Idempotent on idempotency_key. Replays return the first response verbatim.
 *
 * Default-don't-leak: this tool does NOT include diff text in the payload.
 * Agents that want to send a diff must pass it explicitly via payload_json.
 */
import { z } from "zod";
import { type ApiResult, ok, err } from "@statehub/shared";
import type { ToolContext } from "../context.js";
import { getRepoContext, getChangedFiles, getUntrackedFiles } from "../git.js";
import {
  postLocalEvidence,
  RemoteError,
  type LocalEvidenceResponse,
} from "../remote-client.js";

export const syncEvidenceShape = {
  evidence_type: z
    .enum(["test_result", "commit", "file_change", "command", "agent_run"])
    .describe("Evidence category."),
  title: z.string().min(1).describe("Short human-readable title for the evidence row."),
  summary: z.string().optional().describe("Longer free-form description."),
  payload_json: z.string().optional().describe("JSON-encoded extra payload. The sidecar will merge git_context in."),
  artifact_url: z.string().optional().describe("Optional URL to an artifact (CI run, screenshot, etc.)."),
  feature_id: z.string().optional().describe("Feature this evidence belongs to."),
  work_item_id: z.string().optional().describe("Work item this evidence belongs to."),
  agent_run_id: z.string().optional().describe("Agent run this evidence belongs to."),
  idempotency_key: z.string().min(1).describe("Client-generated key; replaying returns the first result."),
};

export const syncEvidenceDescription =
  "Upload evidence (test result, commit, file change, command output, or agent run) to Remote StateHub, with current git context attached. Remote derives trust_state from repo identity + dirty state. Idempotent on idempotency_key. Write (syncs to remote).";

export interface SyncEvidenceArgs {
  evidence_type: "test_result" | "commit" | "file_change" | "command" | "agent_run";
  title: string;
  summary?: string;
  payload_json?: string;
  artifact_url?: string;
  feature_id?: string;
  work_item_id?: string;
  agent_run_id?: string;
  idempotency_key: string;
}

export interface SyncEvidenceData {
  evidence_id: string;
  trust_state: string;
  staleness_state: string;
  match_status: string;
}

export async function syncEvidence(
  ctx: ToolContext,
  args: SyncEvidenceArgs,
): Promise<ApiResult<SyncEvidenceData>> {
  if (!args.idempotency_key?.trim()) {
    return err("validation_error", "idempotency_key is required");
  }
  if (!args.title?.trim()) {
    return err("validation_error", "title is required");
  }

  // 1. Capture git context at call time (not startup — the agent may have
  //    run git operations between MCP calls).
  const repo = getRepoContext(ctx.cwd);
  const changedFiles = getChangedFiles(ctx.cwd);
  const untrackedFiles = getUntrackedFiles(ctx.cwd);

  // 2. Merge caller-supplied payload with git_context.
  let userPayload: Record<string, unknown> = {};
  if (args.payload_json) {
    try {
      userPayload = JSON.parse(args.payload_json) as Record<string, unknown>;
      if (typeof userPayload !== "object" || userPayload === null || Array.isArray(userPayload)) {
        return err("validation_error", "payload_json must be a JSON object");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err("validation_error", `payload_json is not valid JSON: ${msg}`);
    }
  }
  const mergedPayload = {
    ...userPayload,
    git_context: {
      repo_remote_url: repo.repoRemoteUrl,
      git_branch: repo.gitBranch,
      base_sha: repo.baseSha,
      head_sha: repo.headSha,
      dirty_state: repo.dirtyState,
      changed_files: changedFiles,
      untracked_files: untrackedFiles,
    },
  };

  // 3. Build the request body matching LocalEvidenceBody (see local-evidence/route.ts).
  const body = {
    project_id: ctx.resolved.ids.projectId,
    repo_remote_url: repo.repoRemoteUrl,
    git_branch: repo.gitBranch,
    base_sha: repo.baseSha,
    head_sha: repo.headSha,
    dirty_state: repo.dirtyState,
    evidence_type: args.evidence_type,
    title: args.title,
    summary: args.summary,
    payload_json: JSON.stringify(mergedPayload),
    artifact_url: args.artifact_url,
    feature_id: args.feature_id,
    work_item_id: args.work_item_id,
    agent_run_id: args.agent_run_id,
  };

  // 4. POST.
  let res: LocalEvidenceResponse;
  try {
    res = await postLocalEvidence(ctx.config, ctx.resolved.ids, body, args.idempotency_key);
  } catch (e) {
    if (e instanceof RemoteError) {
      return err(
        // The remote already returns a canonical error_code; preserve it.
        (e.code as never) in ERROR_CODE_SET ? (e.code as never) : "external_source_error",
        e.message,
        { retryable: e.status >= 500 || e.status === 0 },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return err("internal_error", `sync_evidence failed: ${msg}`);
  }

  if (!res.ok || !res.data) {
    return err(
      (res.error_code as never) ?? "internal_error",
      res.message ?? "remote returned error",
      { retryable: res.retryable ?? false },
    );
  }

  return ok({
    evidence_id: res.data.evidence_id,
    trust_state: res.data.trust_state,
    staleness_state: res.data.staleness_state,
    match_status: res.data.match_status,
  });
}

// Used to validate that a RemoteError.code is a known ErrorCode before casting.
const ERROR_CODE_SET = new Set<string>([
  "validation_error",
  "unauthorized",
  "workspace_mismatch",
  "scope_missing",
  "not_found",
  "forbidden",
  "conflict",
  "repo_conflict",
  "idempotency_conflict",
  "transition_not_allowed",
  "rate_limited",
  "external_source_error",
  "internal_error",
]);
