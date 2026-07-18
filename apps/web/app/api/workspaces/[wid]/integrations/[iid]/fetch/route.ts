/**
 * POST /api/workspaces/:wid/integrations/:iid/fetch — pull live issues
 * from the integration's provider (GitHub in P07A; Plane/Linear land in
 * P07B). The issues are returned in the importer's expected shape so
 * the wizard can fill the JSON textarea and reuse the existing
 * preview/run pipeline.
 *
 * Body: { max_issues?: number }  (optional; default 1000)
 *
 * Response: { issues: GithubIssue[] | PlaneIssue[] | LinearIssue[], has_more: boolean, pages_fetched: number }
 *
 * Errors:
 *   - integration not found → 404 not_found
 *   - integration has no client yet (markdown) → 400 validation_error
 *   - provider auth failed (401/403) → 502 external_source_error
 *   - provider rate limited (429) → 429 rate_limited
 *   - provider repo not found (404) → 502 external_source_error
 *   - provider unreachable → 502 external_source_error
 *
 * Test-only: when STATEHUB_E2E_FETCH_STUB=1 is set (e2e only), the route
 * injects a stub fetchImpl that returns canned JSON per provider — never
 * set in production. The stub shapes match each provider's API response.
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07a-github-live-fetch/plan.md §5
 * Source: agent_flow/implementation/v1/iterations/20260717-p07b-plane-linear-live-fetch/plan.md §5
 */
import {
  integrationService,
  DomainError,
  NotFoundError,
  ValidationError,
} from "@statehub/domain";
import {
  pickClient,
  isProviderError,
  RateLimitError,
  type GithubIssue,
  type PlaneIssue,
  type LinearIssue,
} from "@statehub/integrations";
import { withEnvelope, parseBody, param } from "@/lib/api-handler";
import { db } from "@/lib/server";
export const runtime = "nodejs";

/** Test-only stub fetch — returns canned JSON per provider.
 *
 * Each call gets a fresh `sessionId` baked into the issue numbers AND
 * URLs so the importer's idempotency check (which keys on
 * external_id=issue.number for github, external_id=issue.id for
 * plane/linear) doesn't find prior links from earlier test runs.
 * This lets preview/run tests assert against `toCreate` rather than
 * `toSkip`.
 *
 * The counter is seeded with `Date.now()/1000` so it's always
 * increasing across dev-server restarts (no collision across runs).
 * The number always contains "7001" / "7002" so the e2e regex
 * assertions (`/7001/`) still match.
 */
let stubCallCounter = Math.floor(Date.now() / 1000);
function stubFetchForProvider(provider: string): typeof fetch {
  const sessionId = ++stubCallCounter;
  if (provider === "plane") {
    const stubIssues: PlaneIssue[] = [
      {
        id: `plane-stub-1-${sessionId}`,
        name: "DEMO-7001",
        description: "E2E stub: plane issue 1",
        state: "started",
        state_group: "started",
        priority: "high",
        project: "Demo",
        cycle: null,
        labels: ["bug"],
        assignees: ["alice"],
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-02T00:00:00Z",
        link: `https://plane.example/demo/projects/demo/issues/DEMO-7001-${sessionId}`,
      },
      {
        id: `plane-stub-2-${sessionId}`,
        name: "DEMO-7002",
        description: "E2E stub: plane issue 2",
        state: "backlog",
        state_group: "backlog",
        priority: "medium",
        project: "Demo",
        cycle: null,
        labels: ["feature"],
        assignees: ["bob"],
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-03T00:00:00Z",
        link: `https://plane.example/demo/projects/demo/issues/DEMO-7002-${sessionId}`,
      },
    ];
    const body = { results: stubIssues, next_page: null, previous_page: null };
    return (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  }
  if (provider === "linear") {
    const stubIssues: LinearIssue[] = [
      {
        id: `linear-stub-1-${sessionId}`,
        identifier: "DEMO-7001",
        title: "E2E stub: linear issue 1",
        description: "Stubbed body for e2e.",
        state: { name: "In Progress", type: "started" },
        priority: 1,
        team: { id: "t1", name: "Demo", key: "DEMO" },
        project: { id: "p1", name: "Q1" },
        cycle: null,
        labels: { nodes: [{ id: "l1", name: "bug" }] },
        assignee: { name: "alice" },
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-02T00:00:00Z",
        url: `https://linear.example/issue/DEMO-7001-${sessionId}`,
      },
      {
        id: `linear-stub-2-${sessionId}`,
        identifier: "DEMO-7002",
        title: "E2E stub: linear issue 2",
        description: "Stubbed body 2.",
        state: { name: "Backlog", type: "backlog" },
        priority: 2,
        team: { id: "t1", name: "Demo", key: "DEMO" },
        project: null,
        cycle: null,
        labels: { nodes: [{ id: "l2", name: "feature" }] },
        assignee: null,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-03T00:00:00Z",
        url: `https://linear.example/issue/DEMO-7002-${sessionId}`,
      },
    ];
    const body = {
      data: {
        team: {
          issues: {
            nodes: stubIssues,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    };
    return (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  }
  // github (default) — return raw GitHub REST shape (labels: [{name: ...}])
  // so GitHubClient's parser maps it to GithubIssue.
  // Number = 7001000 + sessionId so it's unique per call but still
  // contains "7001" for the e2e regex assertion.
  const stubIssues = [
    {
      number: 7001000 + sessionId,
      title: "E2E stub: live fetch issue 1",
      body: "Stubbed body for e2e.",
      state: "open",
      labels: [{ name: "bug" }],
      html_url: `https://github.com/e2e-stub/example/issues/7001-${sessionId}`,
      user: { login: "alice" },
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-02T00:00:00Z",
      milestone: null,
    },
    {
      number: 7002000 + sessionId,
      title: "E2E stub: live fetch issue 2",
      body: "Stubbed body 2.",
      state: "open",
      labels: [{ name: "enhancement" }],
      html_url: `https://github.com/e2e-stub/example/issues/7002-${sessionId}`,
      user: { login: "bob" },
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-03T00:00:00Z",
      milestone: { title: "v1" },
    },
  ];
  return (async () =>
    new Response(JSON.stringify(stubIssues), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const iid = param(params, "iid");

  const decrypted = await integrationService.getDecryptedConfig(db(), wid, iid);
  if (!decrypted) throw new NotFoundError("integration", iid);
  const { provider, config } = decrypted;

  const client = pickClient<GithubIssue | PlaneIssue | LinearIssue>(
    provider,
    config,
  );
  if (!client) {
    throw new ValidationError(
      `live fetch for provider "${provider}" is not supported (markdown is export-only)`,
    );
  }

  const body = await parseBody<{ max_issues?: number }>(req);
  const maxIssues =
    typeof body.max_issues === "number" && body.max_issues > 0
      ? Math.min(body.max_issues, 10000)
      : undefined;

  const useStub = process.env.STATEHUB_E2E_FETCH_STUB === "1";
  try {
    const result = await client.listIssues({
      maxIssues,
      ...(useStub ? { fetchImpl: stubFetchForProvider(provider) } : {}),
    });
    return {
      issues: result.issues,
      has_more: result.hasMore,
      pages_fetched: result.pagesFetched,
      provider,
    };
  } catch (err) {
    if (err instanceof RateLimitError) {
      throw new DomainError(
        "rate_limited",
        err.message,
        err.retryAfterSeconds !== undefined
          ? { retry_after_seconds: err.retryAfterSeconds, provider: err.provider }
          : { provider: err.provider },
      );
    }
    if (isProviderError(err)) {
      throw new DomainError(
        "external_source_error",
        err.message,
        { provider: err.provider, code: err.code },
      );
    }
    // Unknown error — surface as internal_error via the handler's default.
    throw err;
  }
});
