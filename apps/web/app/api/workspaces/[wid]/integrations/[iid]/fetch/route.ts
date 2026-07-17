/**
 * POST /api/workspaces/:wid/integrations/:iid/fetch — pull live issues
 * from the integration's provider (GitHub in P07A; Plane/Linear land in
 * P07B). The issues are returned in the importer's expected shape so
 * the wizard can fill the JSON textarea and reuse the existing
 * preview/run pipeline.
 *
 * Body: { max_issues?: number }  (optional; default 1000)
 *
 * Response: { issues: GithubIssue[], has_more: boolean, pages_fetched: number }
 *
 * Errors:
 *   - integration not found → 404 not_found
 *   - integration has no client yet (plane/linear in P07A) → 400 validation_error
 *   - provider auth failed (401/403) → 502 external_source_error
 *   - provider rate limited (429) → 429 rate_limited
 *   - provider repo not found (404) → 502 external_source_error
 *   - provider unreachable → 502 external_source_error
 *
 * Test-only: when STATEHUB_E2E_FETCH_STUB=1 is set (e2e only), the route
 * injects a stub fetchImpl that returns canned JSON — never set in
 * production. The stub shapes match the GitHub REST /issues response.
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07a-github-live-fetch/plan.md §5
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
} from "@statehub/integrations";
import { withEnvelope, parseBody, param } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/** Test-only stub fetch — returns canned GitHub /issues JSON. */
function stubGithubFetch(): typeof fetch {
  const stubIssues = [
    {
      number: 7001,
      title: "E2E stub: live fetch issue 1",
      body: "Stubbed body for e2e.",
      state: "open",
      labels: [{ name: "bug" }],
      html_url: "https://github.com/e2e-stub/example/issues/7001",
      user: { login: "alice" },
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-02T00:00:00Z",
      milestone: null,
    },
    {
      number: 7002,
      title: "E2E stub: live fetch issue 2",
      body: "Stubbed body 2.",
      state: "open",
      labels: [{ name: "enhancement" }],
      html_url: "https://github.com/e2e-stub/example/issues/7002",
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

  const integration = await integrationService.get(db(), wid, iid);
  if (!integration) throw new NotFoundError("integration", iid);

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(integration.configJson) as Record<string, unknown>;
  } catch {
    throw new ValidationError("integration config_json is corrupt");
  }

  const client = pickClient<GithubIssue>(integration.provider, config);
  if (!client) {
    throw new ValidationError(
      `live fetch for provider "${integration.provider}" is not yet supported (P07A ships github only; plane/linear land in P07B)`,
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
      ...(useStub ? { fetchImpl: stubGithubFetch() } : {}),
    });
    return {
      issues: result.issues,
      has_more: result.hasMore,
      pages_fetched: result.pagesFetched,
      provider: integration.provider,
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
