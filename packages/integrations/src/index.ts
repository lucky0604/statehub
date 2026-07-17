/**
 * @statehub/integrations — provider client abstraction + concrete
 * clients for external integrations (GitHub, Plane, Linear).
 *
 * P07A ships GitHubClient. P07B adds Plane + Linear.
 *
 * Pure I/O — no DB, no domain services, no events. The fetch API route
 * reads the integration's `config_json`, builds the right client via
 * `pickClient`, and calls `listIssues`.
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07a-github-live-fetch/plan.md
 */
export {
  ProviderError,
  AuthError,
  RateLimitError,
  ProviderNotFoundError,
  ProviderUnreachableError,
  isProviderError,
} from "./errors";

export {
  GitHubClient,
  type GithubIssue,
} from "./github-client";

export {
  type ProviderClient,
  type ListIssuesOpts,
  type ListIssuesResult,
  type GitHubClientConfig,
  type PlaneClientConfig,
  type LinearClientConfig,
  type ProviderConfig,
  NO_CLIENT_FOR_PROVIDER,
} from "./provider-client";

import { GitHubClient } from "./github-client";
import {
  type GitHubClientConfig,
  type ProviderClient,
} from "./provider-client";

/**
 * Build the right client for a provider. P07B adds plane + linear
 * cases. For unsupported providers we return null — the route maps
 * that to a clear "live fetch not yet supported" error.
 *
 * We avoid throwing here so the route can produce a structured error
 * envelope instead of a 500.
 */
export function pickClient<TIssue = unknown>(
  provider: "github" | "plane" | "linear" | "markdown",
  config: Record<string, unknown>,
): ProviderClient<TIssue> | null {
  if (provider === "github") {
    const repo = config.repo;
    if (typeof repo !== "string" || !repo.trim()) return null;
    const clientConfig: GitHubClientConfig = {
      repo,
      pat: typeof config.pat === "string" ? config.pat : undefined,
      baseUrl: typeof config.base_url === "string" ? config.base_url : undefined,
    };
    return new GitHubClient(clientConfig) as unknown as ProviderClient<TIssue>;
  }
  // plane + linear land in P07B. markdown is export-only.
  return null;
}
