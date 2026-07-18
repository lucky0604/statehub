/**
 * PlaneClient unit tests — mocked fetch, no real network.
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07b-plane-linear-live-fetch/plan.md §7.1
 */
import { describe, it, expect, vi } from "vitest";
import { PlaneClient } from "../index";

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

function pageBody(count: number, startIndex = 1, nextPage: string | null = null) {
  const issues = [];
  for (let i = 0; i < count; i++) {
    const n = startIndex + i;
    issues.push({
      id: `plane-uuid-${n}`,
      name: `DEMO-${n}`,
      description: `Body ${n}`,
      state: `state-uuid-${n}`,
      state_group: "started",
      priority: "high",
      project: "demo",
      cycle: null,
      labels: ["bug", "ui"],
      assignees: ["alice"],
      created_by: "alice",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      link: `https://plane.example/demo/projects/demo/issues/DEMO-${n}`,
    });
  }
  return { results: issues, next_page: nextPage, previous_page: null };
}

describe("PlaneClient.listIssues", () => {
  it("maps a single page of issues to PlaneIssue shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(2)));
    const client = new PlaneClient({ workspaceSlug: "demo" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toEqual({
      id: "plane-uuid-1",
      name: "DEMO-1",
      description: "Body 1",
      state: "state-uuid-1",
      state_group: "started",
      priority: "high",
      project: "demo",
      cycle: null,
      labels: ["bug", "ui"],
      assignees: ["alice"],
      created_by: "alice",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      link: "https://plane.example/demo/projects/demo/issues/DEMO-1",
    });
    expect(result.hasMore).toBe(false);
    expect(result.pagesFetched).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("/v1/workspaces/demo/issues/");
    expect(url).toContain("per_page=20");
  });

  it("paginates via next_page URL in response body", async () => {
    const page1 = makeResponse(
      pageBody(20, 1, "https://api.plane.so/v1/workspaces/demo/issues/?cursor=abc"),
    );
    const page2 = makeResponse(pageBody(10, 21, null));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    const client = new PlaneClient({ workspaceSlug: "demo" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(30);
    expect(result.pagesFetched).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![0]).toBe(
      "https://api.plane.so/v1/workspaces/demo/issues/?cursor=abc",
    );
  });

  it("respects maxIssues cap and sets hasMore=true", async () => {
    const page1 = makeResponse(
      pageBody(20, 1, "https://api.plane.so/v1/workspaces/demo/issues/?cursor=abc"),
    );
    const fetchImpl = vi.fn().mockResolvedValue(page1);
    const client = new PlaneClient({ workspaceSlug: "demo" });
    const result = await client.listIssues({ fetchImpl, maxIssues: 10 });

    expect(result.issues).toHaveLength(10);
    expect(result.hasMore).toBe(true);
    expect(result.pagesFetched).toBe(1);
  });

  it("stops at one page if next_page is null", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(5)));
    const client = new PlaneClient({ workspaceSlug: "demo" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(5);
    expect(result.pagesFetched).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends api_token as Bearer when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(1)));
    const client = new PlaneClient({ workspaceSlug: "demo", apiToken: "tok_abc" });
    await client.listIssues({ fetchImpl });

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok_abc");
    expect(headers.accept).toBe("application/json");
  });

  it("does not send authorization header when api_token is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(1)));
    const client = new PlaneClient({ workspaceSlug: "demo" });
    await client.listIssues({ fetchImpl });

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("throws AuthError on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ error: "Unauthorized" }, { status: 401 }),
    );
    const client = new PlaneClient({ workspaceSlug: "demo", apiToken: "bad" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "AuthError",
      code: "provider_auth_failed",
      provider: "plane",
    });
  });

  it("throws RateLimitError on 403 with x-ratelimit-remaining: 0", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(
        { error: "Rate limited" },
        {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "retry-after": "30",
          },
        },
      ),
    );
    const client = new PlaneClient({ workspaceSlug: "demo" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "RateLimitError",
      code: "provider_rate_limited",
      retryAfterSeconds: 30,
    });
  });

  it("throws AuthError on 403 without rate-limit-remaining=0", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ error: "Forbidden" }, { status: 403 }),
    );
    const client = new PlaneClient({ workspaceSlug: "demo", apiToken: "scoped" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "AuthError",
      code: "provider_auth_failed",
    });
  });

  it("throws ProviderNotFoundError on 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ error: "Not found" }, { status: 404 }),
    );
    const client = new PlaneClient({ workspaceSlug: "missing" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderNotFoundError",
      code: "provider_not_found",
    });
  });

  it("throws ProviderUnreachableError on network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new PlaneClient({ workspaceSlug: "demo" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderUnreachableError",
      code: "provider_unreachable",
    });
  });

  it("throws generic ProviderError on unexpected status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ error: "Server error" }, { status: 500 }),
    );
    const client = new PlaneClient({ workspaceSlug: "demo" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderError",
      code: "provider_error",
    });
  });

  it("rejects construction with empty workspace_slug", () => {
    expect(() => new PlaneClient({ workspaceSlug: "" })).toThrow();
    expect(() => new PlaneClient({ workspaceSlug: "   " })).toThrow();
  });

  it("respects HARD_PAGE_CAP (20 pages) even if next_page keeps returning", async () => {
    const linkedPage = () =>
      makeResponse(
        pageBody(20, 1, "https://api.plane.so/v1/workspaces/demo/issues/?cursor=more"),
      );
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(linkedPage()),
    );
    const client = new PlaneClient({ workspaceSlug: "demo" });
    const result = await client.listIssues({
      fetchImpl,
      maxIssues: 100000,
    });

    expect(result.pagesFetched).toBe(20);
    expect(result.hasMore).toBe(true);
  });

  it("uses custom baseUrl when configured (self-hosted Plane)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(pageBody(1)));
    const client = new PlaneClient({
      workspaceSlug: "demo",
      baseUrl: "https://plane.internal",
    });
    await client.listIssues({ fetchImpl });

    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("https://plane.internal/v1/workspaces/demo/issues/");
  });
});
