/**
 * LinearClient unit tests — mocked fetch, no real network.
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07b-plane-linear-live-fetch/plan.md §7.1
 */
import { describe, it, expect, vi } from "vitest";
import { LinearClient } from "../index";

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

function gqlPage(count: number, startIndex = 1, hasNextPage = false, endCursor: string | null = null) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const n = startIndex + i;
    nodes.push({
      id: `linear-uuid-${n}`,
      identifier: `DEMO-${n}`,
      title: `Issue ${n}`,
      description: `Body ${n}`,
      state: { name: "In Progress", type: "started" },
      priority: 1,
      team: { id: "t1", name: "Demo", key: "DEMO" },
      project: { id: "p1", name: "Q1" },
      cycle: null,
      labels: { nodes: [{ id: "l1", name: "bug" }] },
      assignee: { name: "alice" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      url: `https://linear.example/issue/DEMO-${n}`,
    });
  }
  return {
    data: {
      team: {
        issues: {
          nodes,
          pageInfo: { hasNextPage, endCursor },
        },
      },
    },
  };
}

describe("LinearClient.listIssues", () => {
  it("maps a single page of issues to LinearIssue shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(gqlPage(2)));
    const client = new LinearClient({ teamKey: "DEMO" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toEqual({
      id: "linear-uuid-1",
      identifier: "DEMO-1",
      title: "Issue 1",
      description: "Body 1",
      state: { name: "In Progress", type: "started" },
      priority: 1,
      team: { id: "t1", name: "Demo", key: "DEMO" },
      project: { id: "p1", name: "Q1" },
      cycle: null,
      labels: { nodes: [{ id: "l1", name: "bug" }] },
      assignee: { name: "alice" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      url: "https://linear.example/issue/DEMO-1",
    });
    expect(result.hasMore).toBe(false);
    expect(result.pagesFetched).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Verify the request shape — GraphQL POST with team key + first.
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.variables.teamKey).toBe("DEMO");
    expect(body.variables.first).toBe(50);
    expect(body.variables.after).toBeNull();
    expect(body.query).toContain("team(key: $teamKey)");
  });

  it("paginates via endCursor when hasNextPage is true", async () => {
    const page1 = makeResponse(gqlPage(50, 1, true, "cursor-abc"));
    const page2 = makeResponse(gqlPage(10, 51, false, null));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    const client = new LinearClient({ teamKey: "DEMO" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(60);
    expect(result.pagesFetched).toBe(2);
    expect(result.hasMore).toBe(false);

    const init2 = fetchImpl.mock.calls[1]![1] as RequestInit;
    const body2 = JSON.parse(init2.body as string);
    expect(body2.variables.after).toBe("cursor-abc");
  });

  it("respects maxIssues cap and sets hasMore=true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(gqlPage(50, 1, true, "cursor-abc")),
    );
    const client = new LinearClient({ teamKey: "DEMO" });
    const result = await client.listIssues({ fetchImpl, maxIssues: 20 });

    expect(result.issues).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(result.pagesFetched).toBe(1);
  });

  it("stops at one page if hasNextPage is false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(gqlPage(10)));
    const client = new LinearClient({ teamKey: "DEMO" });
    const result = await client.listIssues({ fetchImpl });

    expect(result.issues).toHaveLength(10);
    expect(result.pagesFetched).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends api_key in X-API-Key header when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(gqlPage(1)));
    const client = new LinearClient({ teamKey: "DEMO", apiKey: "lin_api_test" });
    await client.listIssues({ fetchImpl });

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("lin_api_test");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("does not send x-api-key header when api_key is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(gqlPage(1)));
    const client = new LinearClient({ teamKey: "DEMO" });
    await client.listIssues({ fetchImpl });

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("throws AuthError on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ errors: [{ message: "Unauthorized" }] }, { status: 401 }),
    );
    const client = new LinearClient({ teamKey: "DEMO", apiKey: "bad" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "AuthError",
      code: "provider_auth_failed",
      provider: "linear",
    });
  });

  it("throws RateLimitError on 429 with retry-after", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(
        { errors: [{ message: "Rate limited" }] },
        {
          status: 429,
          headers: { "retry-after": "60" },
        },
      ),
    );
    const client = new LinearClient({ teamKey: "DEMO" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "RateLimitError",
      code: "provider_rate_limited",
      retryAfterSeconds: 60,
    });
  });

  it("throws ProviderNotFoundError when team is null (key not found)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ data: { team: null } }),
    );
    const client = new LinearClient({ teamKey: "MISSING" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderNotFoundError",
      code: "provider_not_found",
    });
  });

  it("throws ProviderUnreachableError on network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new LinearClient({ teamKey: "DEMO" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderUnreachableError",
      code: "provider_unreachable",
    });
  });

  it("throws ProviderError on GraphQL errors with 200 response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        data: null,
        errors: [{ message: "Cannot query field 'foo'" }],
      }),
    );
    const client = new LinearClient({ teamKey: "DEMO" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderError",
      code: "provider_error",
    });
  });

  it("throws generic ProviderError on unexpected status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({ errors: [{ message: "Server error" }] }, { status: 500 }),
    );
    const client = new LinearClient({ teamKey: "DEMO" });
    await expect(client.listIssues({ fetchImpl })).rejects.toMatchObject({
      name: "ProviderError",
      code: "provider_error",
    });
  });

  it("rejects construction with empty team_key", () => {
    expect(() => new LinearClient({ teamKey: "" })).toThrow();
    expect(() => new LinearClient({ teamKey: "   " })).toThrow();
  });

  it("respects HARD_PAGE_CAP (20 pages) even if hasNextPage keeps returning true", async () => {
    const linkedPage = () =>
      makeResponse(gqlPage(50, 1, true, "cursor-more"));
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(linkedPage()),
    );
    const client = new LinearClient({ teamKey: "DEMO" });
    const result = await client.listIssues({
      fetchImpl,
      maxIssues: 100000,
    });

    expect(result.pagesFetched).toBe(20);
    expect(result.hasMore).toBe(true);
  });

  it("uses custom baseUrl when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(gqlPage(1)));
    const client = new LinearClient({
      teamKey: "DEMO",
      baseUrl: "https://linear.internal",
    });
    await client.listIssues({ fetchImpl });

    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toBe("https://linear.internal/graphql");
  });
});
