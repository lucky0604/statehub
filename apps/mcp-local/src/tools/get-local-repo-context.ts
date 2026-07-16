/**
 * get_local_repo_context — return the current repo's git context + the
 * project_match_status, computed client-side against the cached project
 * repo_url + aliases.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 *         agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2.2
 *
 * Read tool — no remote call (the project identity was cached at startup).
 *
 * match_status:
 *   matched        — local repo_remote_url normalizes to project.repo_url
 *   alias_matched  — local repo_remote_url normalizes to one of the aliases
 *                    (remote project aliases OR config.repoAliases)
 *   unknown        — no match. sync_evidence may still surface a `repo_conflict`
 *                    server-side if the URL is bound to a different project.
 */
import { normalizeRepoUrl, type ApiResult, ok, err } from "@statehub/shared";
import type { ToolContext } from "../context.js";
import { getRepoContext } from "../git.js";

export const getLocalRepoContextShape = {};

export const getLocalRepoContextDescription =
  "Return the current local repo's git context (branch, shas, dirty state, untracked files) and whether its remote URL matches the configured project. Read-only, no network call. Use this before sync_evidence to learn whether evidence will be marked trusted.";

export interface GetLocalRepoContextData {
  repo_path: string;
  repo_remote_url: string | null;
  git_branch: string | null;
  base_sha: string | null;
  head_sha: string | null;
  dirty_state: boolean;
  untracked_files: string[];
  project_match_status: "matched" | "alias_matched" | "unknown";
}

export async function getLocalRepoContext(ctx: ToolContext): Promise<ApiResult<GetLocalRepoContextData>> {
  try {
    const repo = getRepoContext(ctx.cwd);
    const matchStatus = computeMatchStatus(repo.repoRemoteUrl, ctx);

    return ok({
      repo_path: repo.repoPath,
      repo_remote_url: repo.repoRemoteUrl,
      git_branch: repo.gitBranch,
      base_sha: repo.baseSha,
      head_sha: repo.headSha,
      dirty_state: repo.dirtyState,
      untracked_files: repo.untrackedFiles,
      project_match_status: matchStatus,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("internal_error", `get_local_repo_context failed: ${msg}`);
  }
}

function computeMatchStatus(
  repoRemoteUrl: string | null,
  ctx: ToolContext,
): "matched" | "alias_matched" | "unknown" {
  if (!repoRemoteUrl) return "unknown";
  let localNorm: string;
  try {
    localNorm = normalizeRepoUrl(repoRemoteUrl);
  } catch {
    return "unknown";
  }

  const { identity } = ctx.resolved;
  const { config } = ctx;
  if (identity.repoUrl) {
    try {
      if (normalizeRepoUrl(identity.repoUrl) === localNorm) return "matched";
    } catch {
      // malformed stored repo_url — fall through to alias check
    }
  }

  const aliasSet = new Set<string>();
  for (const a of identity.aliases) {
    try {
      aliasSet.add(normalizeRepoUrl(a));
    } catch {
      // skip malformed aliases
    }
  }
  for (const a of config.repoAliases ?? []) {
    try {
      aliasSet.add(normalizeRepoUrl(a));
    } catch {
      // skip malformed config aliases
    }
  }
  if (aliasSet.has(localNorm)) return "alias_matched";
  return "unknown";
}
