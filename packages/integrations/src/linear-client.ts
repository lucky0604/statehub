/**
 * Linear GraphQL client — list issues from a Linear team.
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07b-plane-linear-live-fetch/plan.md
 *
 * Endpoint: POST {baseUrl}/graphql (default https://api.linear.app)
 *
 * Authentication: X-API-Key header (Linear's API key auth — not
 * Bearer). If the API key is missing, the request still goes out;
 * Linear returns 401 which we surface as AuthError.
 *
 * Paginates via GraphQL cursor pagination (`pageInfo.hasNextPage` +
 * `endCursor`) until:
 *   - hasNextPage is false, or
 *   - we have fetched `maxIssues` issues (default 1000), or
 *   - we hit a hard cap of 20 pages (defensive).
 *
 * The raw Linear issue shape is mapped to the `LinearIssue` shape used
 * by `linearIssuesImporter`.
 *
 * Errors:
 *   401 → AuthError
 *   429 → RateLimitError
 *   network failure → ProviderUnreachableError
 *   GraphQL errors with 200 response → ProviderError
 *   other non-OK → ProviderError
 */
import {
  AuthError,
  RateLimitError,
  ProviderNotFoundError,
  ProviderUnreachableError,
  ProviderError,
} from "./errors";
import type {
  LinearClientConfig,
  ListIssuesOpts,
  ListIssuesResult,
  ProviderClient,
} from "./provider-client";

/** The LinearIssue shape used by linearIssuesImporter. */
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  state?: { name: string; type: "backlog" | "unstarted" | "started" | "completed" | "canceled" };
  priority?: number;
  team?: { id: string; name: string; key: string };
  project?: { id: string; name: string } | null;
  cycle?: { id: string; name: string; number: number } | null;
  labels?: { nodes: Array<{ id: string; name: string }> };
  assignee?: { name: string } | null;
  createdAt?: string;
  updatedAt?: string;
  url: string;
}

/** Raw GraphQL response shape — what we read. */
interface LinearGraphQLResponse {
  data?: {
    team?: {
      issues: {
        nodes: LinearIssue[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } | null;
  };
  errors?: Array<{ message: string }> | null;
}

const LINEAR_API_BASE = "https://api.linear.app";
const DEFAULT_MAX_ISSUES = 1000;
const HARD_PAGE_CAP = 20;
const PAGE_SIZE = 50;

const ISSUES_QUERY = `
query FetchIssues($teamKey: String!, $first: Int!, $after: String) {
  team(key: $teamKey) {
    issues(first: $first, after: $after) {
      nodes {
        id
        identifier
        title
        description
        state { name type }
        priority
        team { id name key }
        project { id name }
        cycle { id name number }
        labels { nodes { id name } }
        assignee { name }
        createdAt
        updatedAt
        url
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`.trim();

export class LinearClient implements ProviderClient<LinearIssue> {
  readonly provider = "linear";
  private readonly teamKey: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: LinearClientConfig) {
    if (!config.teamKey?.trim()) {
      throw new ProviderError("LinearClient requires config.team_key", "linear", "provider_config_invalid");
    }
    this.teamKey = config.teamKey;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? LINEAR_API_BASE).replace(/\/+$/, "");
  }

  async listIssues(opts?: ListIssuesOpts): Promise<ListIssuesResult<LinearIssue>> {
    const fetchImpl = opts?.fetchImpl ?? fetch;
    const maxIssues = opts?.maxIssues ?? DEFAULT_MAX_ISSUES;
    const issues: LinearIssue[] = [];
    let pagesFetched = 0;
    let hasMore = false;
    let afterCursor: string | null = null;

    while (pagesFetched < HARD_PAGE_CAP) {
      const res = await this.safeFetch(fetchImpl, afterCursor);
      const body = (await res.json()) as LinearGraphQLResponse;

      if (body.errors && body.errors.length > 0) {
        throw new ProviderError(
          `Linear GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`,
          "linear",
          "provider_error",
        );
      }

      const team = body.data?.team;
      if (!team) {
        // team(key: ...) returns null when the key doesn't exist.
        throw new ProviderNotFoundError(
          `Linear team not found for key: ${this.teamKey}`,
          "linear",
        );
      }

      const pageIssues = team.issues.nodes;
      const pageInfo = team.issues.pageInfo;
      pagesFetched++;

      for (const issue of pageIssues) {
        if (issues.length >= maxIssues) {
          hasMore = true;
          break;
        }
        issues.push(issue);
      }

      if (issues.length >= maxIssues) {
        break;
      }

      if (!pageInfo.hasNextPage || !pageInfo.endCursor) {
        afterCursor = null;
        break;
      }
      afterCursor = pageInfo.endCursor;
    }

    // If we exited because we hit the page cap and there's still more,
    // mark hasMore so the UI can warn.
    if (pagesFetched >= HARD_PAGE_CAP && afterCursor) {
      hasMore = true;
    }

    return { issues, hasMore, pagesFetched };
  }

  private async safeFetch(
    fetchImpl: typeof fetch,
    after: string | null,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${this.baseUrl}/graphql`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        body: JSON.stringify({
          query: ISSUES_QUERY,
          variables: {
            teamKey: this.teamKey,
            first: PAGE_SIZE,
            after,
          },
        }),
      });
    } catch (err) {
      throw new ProviderUnreachableError(
        err instanceof Error ? `network error: ${err.message}` : "network error",
        "linear",
      );
    }

    if (res.ok) return res;

    const bodyText = await res.text().catch(() => "");
    const bodySnippet = bodyText.slice(0, 200);

    if (res.status === 401) {
      throw new AuthError(
        `Linear rejected the API key (401). ${bodySnippet}`.trim(),
        "linear",
      );
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "0");
      const retryAfterSeconds = retryAfter > 0 ? retryAfter : undefined;
      throw new RateLimitError(
        `Linear rate limit exceeded. ${bodySnippet}`.trim(),
        "linear",
        retryAfterSeconds,
      );
    }
    if (res.status === 404) {
      throw new ProviderNotFoundError(
        `Linear endpoint not found (404). ${bodySnippet}`.trim(),
        "linear",
      );
    }
    throw new ProviderError(
      `Linear request failed: ${res.status} ${res.statusText} ${bodySnippet}`.trim(),
      "linear",
      "provider_error",
    );
  }
}
