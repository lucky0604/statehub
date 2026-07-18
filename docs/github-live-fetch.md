# GitHub live fetch

P07A adds a server-side GitHub REST client that pulls open issues
directly from `api.github.com` into the import wizard — no more
paste-from-export. The existing `githubIssuesImporter` preview/run
pipeline is reused unchanged; P07A only adds the fetch path.

## Why

P06B's paste-from-export worked but was a clear v1 shortcoming:
"export issues from github.com, copy JSON, paste here." P07A makes
GitHub import a one-click flow. The idempotency, external_links
tie-back, and import_jobs audit log from P06B all carry over.

## How it works

```
Wizard "Fetch from provider" button
  → POST /api/workspaces/:wid/integrations/:iid/fetch
  → pickClient("github", config) → GitHubClient
  → GitHubClient.listIssues()
     GET /repos/{owner}/{repo}/issues?state=open&per_page=100
     paginate via Link rel="next" (cap: 10 pages / 1000 issues)
     filter out PRs (entries with pull_request field)
     map to GithubIssue shape
  → returns { issues, has_more, pages_fetched }
  → wizard fills the JSON textarea with the issues
  → user clicks Preview → existing P06B preview path
  → user clicks Run import → existing P06B run path
```

## PAT storage

The PAT lives in `integrations.config_json` as plaintext, the same
trust model as P06B and `personal_tokens` (local-only solo-dev app).

- The PAT is never logged.
- The mapper + GET responses strip `pat` (return `null`).
- The fetch route reads the PAT server-side at fetch time only.
- A later hardening iteration can add AES-GCM encryption with a
  workspace key from env. The schema already supports a
  `config_encrypted` column addition via migration when needed.

## Rate limits

- Unauthenticated: 60 requests/hour.
- Authenticated (PAT): 5000 requests/hour.

P07A requires a PAT in the integration for live fetch. If the PAT is
missing, the client still tries unauthenticated and surfaces a 403
cleanly. v1 does not retry or queue.

Rate-limit errors (403 with `X-RateLimit-Remaining: 0`) map to a
`rate_limited` error code with `retry_after_seconds` in the extra
field. The wizard UI surfaces this inline.

## API

### POST /api/workspaces/:wid/integrations/:iid/fetch

Body: `{ max_issues?: number }` (optional; default 1000, max 10000).

Response:
```json
{
  "issues": [GithubIssue, ...],
  "has_more": false,
  "pages_fetched": 1,
  "provider": "github"
}
```

Errors:
| Status | Code | When |
| --- | --- | --- |
| 404 | `not_found` | integration id doesn't exist |
| 400 | `validation_error` | provider is not github (P07A), or config_json corrupt |
| 429 | `rate_limited` | GitHub returned 403 with rate-limit-remaining=0 |
| 502 | `external_source_error` | 401/403/404/network error from GitHub |

The `GithubIssue` shape matches what `githubIssuesImporter.preview()`
expects, so the wizard can pipe the fetch output straight into the
existing preview path.

## Wizard UI

Step 1 of the import wizard has two buttons next to the JSON textarea:

```
[Load sample]  [Fetch from provider]
```

- "Load sample" fills the textarea with canned sample JSON (existing
  P06B behavior).
- "Fetch from provider" calls the fetch route and fills the textarea
  with real issues. A small note above the textarea reports the
  count, page count, and whether more issues are available.

The fetch button is GitHub-only in P07A. For Plane/Linear integrations
the button is still visible but the route returns a clear
"lands in P07B" validation error.

## Pagination

P07A caps at 10 pages (1000 issues). The `has_more` flag in the
response tells the UI when the cap was hit. Larger imports need the
cap raised (via `max_issues` body field, max 10000) or a paginated
UI in a later iteration.

## Testing

### Unit tests

`packages/integrations/src/__tests__/github-client.test.ts` — 21 tests
covering happy path, pagination, maxIssues cap, PR filtering, PAT
header, all error codes, custom baseUrl, since filter, hard page cap.

The tests mock `fetch` via the `fetchImpl` option — no real network.

### E2e

`apps/web/e2e/p07a-github-live-fetch.spec.ts` — exercises the wizard's
fetch button, preview path on fetched issues, run path on fetched
issues, error handling for non-github providers, and 404 on missing
integration.

The e2e suite never hits real GitHub. The playwright config sets
`STATEHUB_E2E_FETCH_STUB=1`, and the fetch route detects this env var
and injects a stub `fetchImpl` that returns canned JSON. Production
never sets this env var.

## Provider client abstraction

`packages/integrations` is a new package, sibling to `packages/ai`.
It contains:

- `ProviderClient<TIssue>` interface — every provider implements this.
- `GitHubClient` — concrete GitHub REST client.
- `pickClient(provider, config)` — factory; returns `null` for
  unsupported providers so the route can produce a structured error.
- Error taxonomy: `ProviderError`, `AuthError`, `RateLimitError`,
  `ProviderNotFoundError`, `ProviderUnreachableError`.

P07B adds `PlaneClient` + `LinearClient` to the same package, with
the same shape. The fetch route's dispatch via `pickClient` extends
to those providers without route changes.

## Future

- **Plane + Linear live fetch** — P07B adds the two clients.
- **Provider-aware create form** — P07C makes the integrations panel
  form switch on provider (workspace_slug for Plane, team_key for
  Linear).
- **Closed-issue import** — `state=open` only in v1; a later
  `include_closed` flag can map closed issues to Done.
- **Webhook backrefs** — a GitHub webhook that updates StateHub when
  an imported issue closes is a later phase.
- **Incremental sync** — the `since` parameter is wired through the
  client but not yet exposed in the UI. A "sync since last fetch"
  button is a later polish.
- **PAT encryption at rest** — see §PAT storage above.
