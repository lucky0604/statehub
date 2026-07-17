/**
 * GitHub REST client — list open issues from a repo.
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07a-github-live-fetch/plan.md
 *
 * Endpoint: GET /repos/{owner}/{repo}/issues?state=open&per_page=100
 *
 * Paginates via the `Link: <...>; rel="next"` header until:
 *   - there is no next page, or
 *   - we have fetched `maxIssues` issues (default 1000), or
 *   - we hit a hard cap of 20 pages (defensive — protects against a
 *     misbehaving Link header).
 *
 * The raw GitHub issue shape is mapped to the `GithubIssue` shape used
 * by `githubIssuesImporter`. PRs (entries with a `pull_request` field)
 * are filtered out — GitHub's /issues endpoint returns PRs too.
 *
 * Errors:
 *   401 → AuthError
 *   403 with X-RateLimit-Remaining: 0 → RateLimitError
 *   403 otherwise → AuthError (treated as permission denied)
 *   404 → ProviderNotFoundError
 *   network failure → ProviderUnreachableError
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
  GitHubClientConfig,
  ListIssuesOpts,
  ListIssuesResult,
  ProviderClient,
} from "./provider-client";

/** Subset of the GitHub REST issue shape — what we read. */
interface RawGithubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  labels?: Array<{ name: string }>;
  html_url: string;
  user?: { login: string } | null;
  created_at?: string;
  updated_at?: string;
  milestone?: { title: string } | null;
  /** Present on PRs — we filter these out. */
  pull_request?: unknown;
}

/** The GithubIssue shape used by githubIssuesImporter. */
export interface GithubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  labels?: string[];
  html_url: string;
  user?: { login: string };
  created_at?: string;
  updated_at?: string;
  milestone?: { title: string } | null;
}

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_MAX_ISSUES = 1000;
const HARD_PAGE_CAP = 20;
const PER_PAGE = 100;

export class GitHubClient implements ProviderClient<GithubIssue> {
  readonly provider = "github";
  private readonly repo: string;
  private readonly pat?: string;
  private readonly baseUrl: string;

  constructor(config: GitHubClientConfig) {
    if (!config.repo?.trim()) {
      throw new ProviderError("GitHubClient requires config.repo", "github", "provider_config_invalid");
    }
    this.repo = config.repo;
    this.pat = config.pat;
    this.baseUrl = (config.baseUrl ?? GITHUB_API_BASE).replace(/\/+$/, "");
  }

  async listIssues(opts?: ListIssuesOpts): Promise<ListIssuesResult<GithubIssue>> {
    const fetchImpl = opts?.fetchImpl ?? fetch;
    const maxIssues = opts?.maxIssues ?? DEFAULT_MAX_ISSUES;
    const issues: GithubIssue[] = [];
    let pagesFetched = 0;
    let hasMore = false;
    let nextUrl: string | null = buildIssuesUrl(this.baseUrl, this.repo, opts?.since);

    while (nextUrl && pagesFetched < HARD_PAGE_CAP) {
      const res = await this.safeFetch(fetchImpl, nextUrl);
      const pageIssues = parseIssues(await res.json());
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

      nextUrl = extractNextLink(res.headers.get("link"));
    }

    // If we exited the loop because we hit the page cap (not because
    // we ran out of issues or hit maxIssues), and there's still a next
    // page, mark hasMore so the UI can warn.
    if (pagesFetched >= HARD_PAGE_CAP && nextUrl) {
      hasMore = true;
    }

    return { issues, hasMore, pagesFetched };
  }

  private async safeFetch(
    fetchImpl: typeof fetch,
    url: string,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(this.pat ? { authorization: `Bearer ${this.pat}` } : {}),
        },
      });
    } catch (err) {
      throw new ProviderUnreachableError(
        err instanceof Error ? `network error: ${err.message}` : "network error",
        "github",
      );
    }

    if (res.ok) return res;

    const bodyText = await res.text().catch(() => "");
    const bodySnippet = bodyText.slice(0, 200);

    if (res.status === 401) {
      throw new AuthError(
        `GitHub rejected the PAT (401). ${bodySnippet}`.trim(),
        "github",
      );
    }
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const retryAfter = Number(res.headers.get("x-ratelimit-reset") ?? "0");
        const retryAfterSeconds = retryAfter > 0
          ? Math.max(1, Math.floor(retryAfter - Date.now() / 1000))
          : undefined;
        throw new RateLimitError(
          `GitHub rate limit exceeded. ${bodySnippet}`.trim(),
          "github",
          retryAfterSeconds,
        );
      }
      throw new AuthError(
        `GitHub returned 403 (permission denied or PAT lacks repo scope). ${bodySnippet}`.trim(),
        "github",
      );
    }
    if (res.status === 404) {
      throw new ProviderNotFoundError(
        `GitHub repo not found (404): ${this.repo}. ${bodySnippet}`.trim(),
        "github",
      );
    }
    throw new ProviderError(
      `GitHub request failed: ${res.status} ${res.statusText} ${bodySnippet}`.trim(),
      "github",
      "provider_error",
    );
  }
}

function buildIssuesUrl(baseUrl: string, repo: string, since?: string): string {
  const params = new URLSearchParams({
    state: "open",
    per_page: String(PER_PAGE),
  });
  if (since) params.set("since", since);
  return `${baseUrl}/repos/${repo}/issues?${params.toString()}`;
}

function parseIssues(raw: unknown): GithubIssue[] {
  if (!Array.isArray(raw)) return [];
  const issues: GithubIssue[] = [];
  for (const item of raw) {
    if (!isRawIssue(item)) continue;
    if (item.pull_request !== undefined) continue;
    issues.push({
      number: item.number,
      title: item.title,
      body: item.body ?? null,
      state: item.state,
      labels: Array.isArray(item.labels) ? item.labels.map((l) => l.name) : [],
      html_url: item.html_url,
      user: item.user ? { login: item.user.login } : undefined,
      created_at: item.created_at,
      updated_at: item.updated_at,
      milestone: item.milestone ?? null,
    });
  }
  return issues;
}

function isRawIssue(item: unknown): item is RawGithubIssue {
  if (typeof item !== "object" || item === null) return false;
  const r = item as Record<string, unknown>;
  return typeof r.number === "number"
    && typeof r.title === "string"
    && typeof r.html_url === "string"
    && (r.state === "open" || r.state === "closed");
}

/**
 * Parse a GitHub Link header and return the next page URL, or null.
 * Example Link header:
 *   <https://api.github.com/...&page=2>; rel="next",
 *   <https://api.github.com/...&page=5>; rel="last"
 */
function extractNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") return match[1]!;
  }
  return null;
}
