/**
 * GitHubClient unit tests — mocked fetch, no real network.
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07a-github-live-fetch/plan.md §7.1
 */
import { describe, it, expect, vi } from "vitest";
import {
  GitHubClient,
  AuthError,
  RateLimitError,
  ProviderNotFoundError,
  ProviderUnreachableError,
  ProviderError,
  isProviderError,
} from "../index";

function makeResponse(
  body: unknown,
  opts: {
    status?: number;
    headers?: Record<string, string>;
  } = {},
): Response {
  const status = opts.status ?? 200;
  const headers = new Headers(opts.headers);
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

function pageBody(count: number, startIndex = 1, includePr = false) {
  const issues = [];
  for (let i = 0; i < count; i++) {
    const n = startIndex + i;
    issues.push({
      number: n,
      title: `Issue ${n}`,
      body: `Body ${n}`,
      state: "open",
      labels: [{ name: "bug" }, { name: "ui" }],
      html_url: `https://github.com/owner/repo/issues/${n}`,
      user: { login: "alice" },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      milestone: null,
    });
  }
  if (includePr) {
    issues.push({
      number: 999,
      title: "PR in issues list",
      body: "should be filtered",
      state: "open",
      labels: [],
      html_url: "https://github.com/owner/repo/pull/999",
      user: { login: "alice" },
      pull_request: { url: "..." },
    });
  }
  return issues;
}

describe("GitHubClient.listIssues", () => {
  it("maps a single page of issues to GithubIssue shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(3)));
    const client = new GitHubClient({ repo: "owner/repo" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(3);
    expect(result.issues[0]).toEqual({
      number: 1,
      title: "Issue 1",
      body: "Body 1",
      state: "open",
      labels: ["bug", "ui"],
      html_url: "https://github.com/owner/repo/issues/1",
      user: { login: "alice" },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      milestone: null,
    });
    expect(result.hasMore).toBe(false);
    expect(result.pagesFetched).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("/repos/owner/repo/issues");
    expect(url).toContain("state=open");
    expect(url).toContain("per_page=100");
  });

  it("filters out PR entries (those with pull_request field)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(pageBody(2, 1, true)));
    const client = new GitHubClient({ repo: "owner/repo" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(2);
    expect(result.issues.find((i) => i.number === 999)).toBeUndefined();
  });

  it("paginates via Link rel=next header", async () => {
    const page1 = makeResponse(pageBody(100, 1), {
      headers: {
        link: '<https://api.github.com/repos/owner/repo/issues?page=2>; rel="next"',
      },
    });
    const page2 = makeResponse(pageBody(50, 101));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    const client = new GitHubClient({ repo: "owner/repo" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(150);
    expect(result.pagesFetched).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![0]).toBe(
      "https://api.github.com/repos/owner/repo/issues?page=2",
    );
  });

  it("respects maxIssues cap and sets hasMore=true", async () => {
    const page1 = makeResponse(pageBody(100, 1), {
      headers: {
        link: '<https://api.github.com/repos/owner/repo/issues?page=2>; rel="next"',
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(page1);
    const client = new GitHubClient({ repo: "owner/repo" });
    const result = await client.listIssues({ fetchImpl, maxIssues: 50 });

    expect(result.issues).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.pagesFetched).toBe(1);
  });

  it("stops at one page if no Link rel=next", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(10)));
    const client = new GitHubClient({ repo: "owner/repo" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(10);
    expect(result.pagesFetched).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends PAT as Bearer token when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(1)));
    const client = new GitHubClient({ repo: "owner/repo", pat: "ghp_test" });
    await client.listIssues({ fetchImpl });

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ghp_test");
    expect(headers.accept).toBe("application/vnd.github+json");
  });

  it("does not send authorization header when PAT is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(1)));
    const client = new GitHubClient({ repo: "owner/repo" });
    await client.listIssues({ fetchImpl });

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("throws AuthError on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ message: "Bad credentials" }, { status: 401 }),
    );
    const client = new GitHubClient({ repo: "owner/repo", pat: "bad" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "AuthError",
      code: "provider_auth_failed",
      provider: "github",
    });
  });

  it("throws RateLimitError on 403 with X-RateLimit-Remaining: 0", async () => {
    const retryAfter = Math.floor(Date.now() / 1000) + 60;
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(retryAfter),
          },
        },
      ),
    );
    const client = new GitHubClient({ repo: "owner/repo" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "RateLimitError",
      code: "provider_rate_limited",
    });
  });

  it("throws AuthError on 403 without rate-limit-remaining=0 (treated as permission)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(
        { message: "Permission denied" },
        { status: 403 },
      ),
    );
    const client = new GitHubClient({ repo: "owner/repo", pat: "scoped" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "AuthError",
      code: "provider_auth_failed",
    });
  });

  it("throws ProviderNotFoundError on 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ message: "Not Found" }, { status: 404 }),
    );
    const client = new GitHubClient({ repo: "owner/missing" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderNotFoundError",
      code: "provider_not_found",
    });
  });

  it("throws ProviderUnreachableError on network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new GitHubClient({ repo: "owner/repo" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderUnreachableError",
      code: "provider_unreachable",
    });
  });

  it("throws generic ProviderError on unexpected status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ message: "Server error" }, { status: 500 }),
    );
    const client = new GitHubClient({ repo: "owner/repo" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderError",
      code: "provider_error",
    });
  });

  it("rejects construction with empty repo", () => {
    expect(() => new GitHubClient({ repo: "" })).toThrow();
    expect(() => new GitHubClient({ repo: "   " })).toThrow();
  });

  it("isProviderError narrows ProviderError subclasses", () => {
    const err = new AuthError("bad", "github");
    expect(isProviderError(err)).toBe(true);
    expect(isProviderError(new Error("plain"))).toBe(false);
  });

  it("respects HARD_PAGE_CAP (20 pages) even if Link keeps returning next", async () => {
    const linkedPage = () =>
      makeResponse(pageBody(100), {
        headers: {
          link: '<https://api.github.com/x?page=next>; rel="next"',
        },
      });
    // mockImplementation so each call returns a fresh Response (body
    // can only be read once).
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(linkedPage()),
    );
    const client = new GitHubClient({ repo: "owner/repo" });
    const result = await client.listIssues({
      fetchImpl,
      maxIssues: 100000,
    });

    expect(result.pagesFetched).toBe(20);
    expect(result.hasMore).toBe(true);
  });

  it("uses since filter when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(1)));
    const client = new GitHubClient({ repo: "owner/repo" });
    await client.listIssues({
      fetchImpl,
      since: "2026-01-01T00:00:00Z",
    });

    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("since=2026-01-01T00%3A00%3A00Z");
  });

  it("uses custom baseUrl when configured (GitHub Enterprise)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(1)));
    const client = new GitHubClient({
      repo: "owner/repo",
      baseUrl: "https://github.example/api/v3",
    });
    await client.listIssues({ fetchImpl });

    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("https://github.example/api/v3/repos/owner/repo/issues");
  });
});

describe("ProviderError classes", () => {
  it("RateLimitError carries retryAfterSeconds when provided", () => {
    const err = new RateLimitError("limited", "github", 60);
    expect(err.retryAfterSeconds).toBe(60);
    expect(err.code).toBe("provider_rate_limited");
  });

  it("RateLimitError retryAfterSeconds is optional", () => {
    const err = new RateLimitError("limited", "github");
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it("all subclasses extend ProviderError", () => {
    expect(new AuthError("x", "github")).toBeInstanceOf(ProviderError);
    expect(new RateLimitError("x", "github")).toBeInstanceOf(ProviderError);
    expect(new ProviderNotFoundError("x", "github")).toBeInstanceOf(ProviderError);
    expect(new ProviderUnreachableError("x", "github")).toBeInstanceOf(ProviderError);
  });
});
