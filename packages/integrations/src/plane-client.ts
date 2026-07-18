/**
 * Plane REST client — list issues from a Plane workspace.
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07b-plane-linear-live-fetch/plan.md
 *
 * Endpoint: GET /v1/workspaces/{workspace_slug}/issues/?per_page=20
 *
 * Paginates via the `next_page` URL in the response body (Plane does
 * not use the Link header) until:
 *   - the response has no `next_page`, or
 *   - we have fetched `maxIssues` issues (default 1000), or
 *   - we hit a hard cap of 20 pages (defensive — protects against a
 *     misbehaving API).
 *
 * The raw Plane issue shape is mapped to the `PlaneIssue` shape used
 * by `planeIssuesImporter`.
 *
 * Errors:
 *   401 → AuthError
 *   403 with X-RateLimit-Remaining: 0 → RateLimitError
 *   403 otherwise → AuthError (permission denied)
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
  PlaneClientConfig,
  ListIssuesOpts,
  ListIssuesResult,
  ProviderClient,
} from "./provider-client";

/** Subset of the Plane REST issue shape — what we read. */
interface RawPlaneIssue {
  id: string;
  name: string;
  description?: string | null;
  state?: string;
  state_group?: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  priority?: "urgent" | "high" | "medium" | "low" | "none";
  project?: string;
  cycle?: { id: string; name: string } | null;
  labels?: string[];
  assignees?: string[];
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  link: string;
}

/** The PlaneIssue shape used by planeIssuesImporter. */
export interface PlaneIssue {
  id: string;
  name: string;
  description?: string | null;
  state?: string;
  state_group?: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  priority?: "urgent" | "high" | "medium" | "low" | "none";
  project?: string;
  cycle?: { id: string; name: string } | null;
  labels?: string[];
  assignees?: string[];
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  link: string;
}

interface PlaneListResponse {
  results: RawPlaneIssue[];
  next_page: string | null;
  previous_page: string | null;
}

const PLANE_API_BASE = "https://api.plane.so";
const DEFAULT_MAX_ISSUES = 1000;
const HARD_PAGE_CAP = 20;
const PER_PAGE = 20;

export class PlaneClient implements ProviderClient<PlaneIssue> {
  readonly provider = "plane";
  private readonly workspaceSlug: string;
  private readonly apiToken?: string;
  private readonly baseUrl: string;

  constructor(config: PlaneClientConfig) {
    if (!config.workspaceSlug?.trim()) {
      throw new ProviderError("PlaneClient requires config.workspace_slug", "plane", "provider_config_invalid");
    }
    this.workspaceSlug = config.workspaceSlug;
    this.apiToken = config.apiToken;
    this.baseUrl = (config.baseUrl ?? PLANE_API_BASE).replace(/\/+$/, "");
  }

  async listIssues(opts?: ListIssuesOpts): Promise<ListIssuesResult<PlaneIssue>> {
    const fetchImpl = opts?.fetchImpl ?? fetch;
    const maxIssues = opts?.maxIssues ?? DEFAULT_MAX_ISSUES;
    const issues: PlaneIssue[] = [];
    let pagesFetched = 0;
    let hasMore = false;
    let nextUrl: string | null = buildIssuesUrl(this.baseUrl, this.workspaceSlug);

    while (nextUrl && pagesFetched < HARD_PAGE_CAP) {
      const res = await this.safeFetch(fetchImpl, nextUrl);
      const body = (await res.json()) as PlaneListResponse;
      const pageIssues = body.results ?? [];
      pagesFetched++;

      for (const issue of pageIssues) {
        if (issues.length >= maxIssues) {
          hasMore = true;
          break;
        }
        issues.push(mapIssue(issue));
      }

      if (issues.length >= maxIssues) {
        break;
      }

      nextUrl = body.next_page ?? null;
    }

    // If we exited because we hit the page cap and there's still a next
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
          accept: "application/json",
          ...(this.apiToken ? { authorization: `Bearer ${this.apiToken}` } : {}),
        },
      });
    } catch (err) {
      throw new ProviderUnreachableError(
        err instanceof Error ? `network error: ${err.message}` : "network error",
        "plane",
      );
    }

    if (res.ok) return res;

    const bodyText = await res.text().catch(() => "");
    const bodySnippet = bodyText.slice(0, 200);

    if (res.status === 401) {
      throw new AuthError(
        `Plane rejected the API token (401). ${bodySnippet}`.trim(),
        "plane",
      );
    }
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        const retryAfterSeconds = retryAfter > 0 ? retryAfter : undefined;
        throw new RateLimitError(
          `Plane rate limit exceeded. ${bodySnippet}`.trim(),
          "plane",
          retryAfterSeconds,
        );
      }
      throw new AuthError(
        `Plane returned 403 (permission denied). ${bodySnippet}`.trim(),
        "plane",
      );
    }
    if (res.status === 404) {
      throw new ProviderNotFoundError(
        `Plane workspace not found (404): ${this.workspaceSlug}. ${bodySnippet}`.trim(),
        "plane",
      );
    }
    throw new ProviderError(
      `Plane request failed: ${res.status} ${res.statusText} ${bodySnippet}`.trim(),
      "plane",
      "provider_error",
    );
  }
}

function buildIssuesUrl(baseUrl: string, workspaceSlug: string): string {
  const params = new URLSearchParams({ per_page: String(PER_PAGE) });
  return `${baseUrl}/v1/workspaces/${workspaceSlug}/issues/?${params.toString()}`;
}

function mapIssue(raw: RawPlaneIssue): PlaneIssue {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    state: raw.state,
    state_group: raw.state_group,
    priority: raw.priority,
    project: raw.project,
    cycle: raw.cycle ?? null,
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    assignees: Array.isArray(raw.assignees) ? raw.assignees : [],
    created_by: raw.created_by,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    link: raw.link,
  };
}
