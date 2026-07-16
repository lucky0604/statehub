/**
 * collect_git_evidence — gather git facts about the working tree.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 *         agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2.3
 *
 * Default-don't-leak (plan §0.8, §6.2): file lists + diff stat are returned,
 * NEVER the full diff text. `include_diff: true` opts in to a 64KB-truncated
 * diff — agents should use this only when they explicitly need it (e.g. to
 * paste into a PR description). The diff does NOT leave the local process
 * unless the agent then calls sync_evidence with it in payload_json.
 */
import { z } from "zod";
import { type ApiResult, ok, err } from "@statehub/shared";
import type { ToolContext } from "../context.js";
import {
  getChangedFiles,
  getUntrackedFiles,
  getDiffStat,
  getLatestCommit,
  getFullDiff,
  type DiffStat,
  type LatestCommit,
} from "../git.js";

export const collectGitEvidenceShape = {
  include_diff: z.boolean().optional().describe("Opt in to full diff text (64KB max). Default false — diff text is NOT returned."),
  include_untracked: z.boolean().optional().describe("Include untracked files in the result. Default true."),
};

export const collectGitEvidenceDescription =
  "Gather git evidence about the working tree: changed files, untracked files, diff stat, latest commit. Default-don't-leak: full diff text is NOT returned unless include_diff=true. Read-only.";

export interface CollectGitEvidenceData {
  changed_files: string[];
  untracked_files: string[];
  diff_stat: DiffStat;
  latest_commit: LatestCommit | null;
  dirty_state: boolean;
  diff_text?: string;
}

export interface CollectGitEvidenceArgs {
  include_diff?: boolean;
  include_untracked?: boolean;
}

export async function collectGitEvidence(
  ctx: ToolContext,
  args: CollectGitEvidenceArgs = {},
): Promise<ApiResult<CollectGitEvidenceData>> {
  try {
    const includeUntracked = args.include_untracked ?? true;
    const changed = getChangedFiles(ctx.cwd);
    const untracked = includeUntracked ? getUntrackedFiles(ctx.cwd) : [];
    const diffStat = getDiffStat(ctx.cwd);
    const latestCommit = getLatestCommit(ctx.cwd);
    const dirtyState = changed.length > 0 || untracked.length > 0;

    const result: CollectGitEvidenceData = {
      changed_files: changed,
      untracked_files: untracked,
      diff_stat: diffStat,
      latest_commit: latestCommit,
      dirty_state: dirtyState,
    };

    if (args.include_diff) {
      result.diff_text = getFullDiff(ctx.cwd) ?? undefined;
    }

    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("internal_error", `collect_git_evidence failed: ${msg}`);
  }
}
