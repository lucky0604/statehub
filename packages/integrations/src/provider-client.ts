/**
 * ProviderClient interface — every external provider (GitHub, Plane,
 * Linear) implements this. The fetch API route dispatches to the right
 * client via pickClient().
 *
 * P07A ships only GitHubClient. P07B adds Plane + Linear.
 *
 * The client is pure I/O — no DB, no domain services, no events. The
 * route handler is responsible for persistence (none — fetch is
 * read-only) and audit (the import_job events cover the run).
 */

export interface ListIssuesOpts {
  /** Cap on total issues returned. Default 1000. */
  maxIssues?: number;
  /** Optional since filter (ISO date) — for incremental sync later. */
  since?: string;
  /** Optional fetch override (tests / e2e stub). */
  fetchImpl?: typeof fetch;
}

export interface ListIssuesResult<TIssue> {
  issues: TIssue[];
  /** True if the provider had more issues than maxIssues. */
  hasMore: boolean;
  /** Page count actually fetched — for UI display. */
  pagesFetched: number;
}

export interface ProviderClient<TIssue> {
  readonly provider: string;
  listIssues(opts?: ListIssuesOpts): Promise<ListIssuesResult<TIssue>>;
}

/**
 * Per-provider config shapes — what the route pulls out of
 * `integration.config_json`.
 */
export interface GitHubClientConfig {
  /** "owner/repo" — required. */
  repo: string;
  /** PAT — optional but recommended (60/hour unauthenticated vs 5000/hour). */
  pat?: string;
  /** Optional API base URL override (for GitHub Enterprise). */
  baseUrl?: string;
}

export interface PlaneClientConfig {
  workspaceSlug: string;
  apiToken?: string;
  baseUrl?: string;
}

export interface LinearClientConfig {
  teamKey: string;
  apiKey?: string;
  baseUrl?: string;
}

export type ProviderConfig =
  | { provider: "github"; config: GitHubClientConfig }
  | { provider: "plane"; config: PlaneClientConfig }
  | { provider: "linear"; config: LinearClientConfig };

/**
 * Sentinel returned when a provider has no live client yet. The route
 * maps this to a clear "lands in a later slice" error.
 */
export const NO_CLIENT_FOR_PROVIDER = Symbol("no-client-for-provider");
