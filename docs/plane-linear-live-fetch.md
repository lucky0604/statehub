# Plane + Linear live fetch

P07B extends the P07A live-fetch path to Plane and Linear integrations.
The user picks a Plane or Linear integration, clicks "Fetch from
provider", and StateHub pulls real issues from the provider's API and
feeds them into the existing `planeIssuesImporter` / `linearIssuesImporter`
preview/run pipelines.

P07A established the provider-client abstraction in
`packages/integrations` with `GitHubClient`. P07B adds `PlaneClient`
(REST) and `LinearClient` (GraphQL) to the same package, both
implementing the `ProviderClient<TIssue>` interface. The fetch route's
`pickClient` dispatch extends to those providers without route changes.

## How it works

```
Wizard "Fetch from provider" button
  → POST /api/workspaces/:wid/integrations/:iid/fetch
  → pickClient(provider, config) → PlaneClient | LinearClient
  → client.listIssues()
     Plane:  GET /v1/workspaces/{slug}/issues/?per_page=20
             paginate via next_page URL in response body
             cap: 10 pages / 1000 issues
     Linear: POST /graphql with team(key:) query
             paginate via pageInfo.endCursor (GraphQL cursor)
             cap: 10 pages / 1000 issues
  → returns { issues, has_more, pages_fetched, provider }
  → wizard fills the JSON textarea with the issues
  → user clicks Preview → existing P06C preview path
  → user clicks Run import → existing P06C run path
```

## Token storage

Tokens are encrypted at rest with **AES-256-GCM** before being written
to `integrations.config_json` (P07D). The encryption key is read from
`STATEHUB_INTEGRATION_KEY` (32 bytes, base64-encoded).

See [`docs/github-live-fetch.md`](./github-live-fetch.md) for full
setup, migration, and threat-model details — the mechanism is identical
across all three providers. Per-provider secret fields:

- **plane**: `api_token`
- **linear**: `api_key`

### Setup

```bash
pnpm --filter @statehub/web run gen:integration-key
# → STATEHUB_INTEGRATION_KEY=...
```

### GET responses

GET responses **never** return the token — encrypted or not. The
mapper masks it as `"api_token":"••••"` (plane) or `"api_key":"••••"`
(linear). The fetch route decrypts internally via
`integrationService.getDecryptedConfig()`.

### Migration

Existing integrations created before P07D may still have plaintext
tokens. The fetch route reads them via legacy fallback. To encrypt,
PATCH the integration with a fresh token.

### Other guarantees

- The token is never logged.
- Event payloads strip the token entirely (not even the ciphertext
  appears in the event log).
- Non-secret config (`workspace_slug`, `team_key`, `base_url`) stays
  plaintext so the UI can display it without decryption.

### Plane

Config: `{ workspace_slug: "demo", api_token?: "pla_...", base_url?: "https://api.plane.so" }`

The `api_token` is sent as `Authorization: Bearer {api_token}`. If
missing, the request goes unauthenticated (Plane returns 401 which we
surface cleanly).

Self-hosted Plane users override `base_url` to point at their instance.

### Linear

Config: `{ team_key: "DEMO", api_key?: "lin_api_...", base_url?: "https://api.linear.app" }`

The `api_key` is sent as `X-API-Key: {api_key}` (Linear's API key auth,
NOT Bearer). If missing, Linear returns 401 which we surface cleanly.

## Rate limits

### Plane
- Cloud: ~600 req/hour per workspace.
- Self-hosted: no rate limit (your server, your rules).

Rate-limit errors (403 with `x-ratelimit-remaining: 0`) map to
`rate_limited` with `retry_after_seconds` from the `retry-after` header.

### Linear
- ~2000 req/minute per API key, with bursts.

Rate-limit errors (429) map to `rate_limited` with `retry_after_seconds`
from the `retry-after` header.

## API

### POST /api/workspaces/:wid/integrations/:iid/fetch

Body: `{ max_issues?: number }` (optional; default 1000, max 10000).

Response:
```json
{
  "issues": [PlaneIssue | LinearIssue | GithubIssue, ...],
  "has_more": false,
  "pages_fetched": 1,
  "provider": "plane" | "linear" | "github"
}
```

Errors (same as P07A):
| Status | Code | When |
| --- | --- | --- |
| 404 | `not_found` | integration id doesn't exist |
| 400 | `validation_error` | provider is markdown (export-only), or config_json corrupt |
| 429 | `rate_limited` | provider returned 403/429 with rate-limit headers |
| 502 | `external_source_error` | 401/403/404/network error from provider |

## Wizard UI

No UI changes from P07A. The "Fetch from provider" button is enabled
for all import-capable providers (github, plane, linear). The tooltip
now reads "Pull live issues from {provider}" — the P07A "lands in P07B"
message is gone.

## Pagination

P07B caps at 10 pages (1000 issues) for both Plane and Linear, same as
GitHub. The `has_more` flag tells the UI when the cap was hit.

- **Plane**: paginates via `next_page` URL in the response body (not
  the Link header).
- **Linear**: paginates via GraphQL cursor pagination
  (`pageInfo.hasNextPage` + `endCursor`).

## Testing

### Unit tests

- `packages/integrations/src/__tests__/plane-client.test.ts` — 15 tests
  covering happy path, next_page pagination, maxIssues cap, all error
  codes, custom baseUrl, Bearer auth header, HARD_PAGE_CAP.
- `packages/integrations/src/__tests__/linear-client.test.ts` — 15 tests
  covering happy path, cursor pagination, maxIssues cap, all error
  codes, custom baseUrl, X-API-Key header, GraphQL errors, HARD_PAGE_CAP.

All tests mock `fetch` via the `fetchImpl` option — no real network.

### E2e

`apps/web/e2e/p07b-plane-linear-live-fetch.spec.ts` — 8 tests covering:
- Fetch on plane integration fills textarea with PlaneIssue JSON.
- Preview works on fetched plane issues.
- Run on fetched plane issues creates work items.
- Same three tests for linear.
- Fetch API route returns PlaneIssue shape.
- Fetch API route returns LinearIssue shape.

The e2e suite never hits real Plane or Linear. The playwright config
sets `STATEHUB_E2E_FETCH_STUB=1`, and the fetch route detects this env
var and injects a per-provider stub `fetchImpl` that returns canned
JSON. The stub uses a session-seeded counter so issue numbers/IDs are
unique per call — this avoids the importer's idempotency check finding
prior links from earlier test runs.

Production never sets this env var.

## Provider client abstraction

`packages/integrations` now contains three clients:

- `GitHubClient` — REST, paginate via Link rel="next" (P07A).
- `PlaneClient` — REST, paginate via next_page URL in body (P07B).
- `LinearClient` — GraphQL, paginate via cursor (P07B).

All implement `ProviderClient<TIssue>` and share the same error
taxonomy (`ProviderError`, `AuthError`, `RateLimitError`,
`ProviderNotFoundError`, `ProviderUnreachableError`).

`pickClient(provider, config)` dispatches to the right client. For
unsupported providers (`markdown` is export-only) it returns `null`,
and the route produces a structured `validation_error`.

## Future

- **Provider-aware create form** — P07C makes the integrations panel
  form switch on provider (workspace_slug for Plane, team_key for
  Linear, repo for GitHub). P07B keeps the form GitHub-focused.
- **Closed-issue import** — open states only in v1; a later
  `include_closed` flag can map closed issues to Done.
- **Webhook backrefs** — provider webhooks that update StateHub when
  an imported issue closes is a later phase.
- **Incremental sync** — the `since` parameter is wired through the
  GitHub client but not yet exposed in the UI. A "sync since last
  fetch" button is a later polish.
- **Token encryption at rest** — same plaintext `config_json` trust
  model as P07A. A later hardening iteration can add AES-GCM encryption.
