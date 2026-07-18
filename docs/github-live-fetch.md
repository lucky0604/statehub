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

The PAT is encrypted at rest with **AES-256-GCM** before being written
to `integrations.config_json` (P07D). The encryption key is read from
`STATEHUB_INTEGRATION_KEY` (32 bytes, base64-encoded).

### Setup

Generate a key and put it in `apps/web/.env.local`:

```bash
pnpm --filter @statehub/web run gen:integration-key
# → STATEHUB_INTEGRATION_KEY=...
```

If the env var is missing:
- Creating an integration **with a PAT** → 500 `internal_error`
  ("STATEHUB_INTEGRATION_KEY is not set").
- Creating an integration **without a PAT** (just `repo`) → works fine.
- Listing / getting integrations → works fine (PAT is masked, no
  decrypt needed).
- Fetching from an integration that has a PAT → 500 `internal_error`.

### What gets encrypted

Only the secret field (`pat` for github) is encrypted. The stored
`config_json` looks like:

```json
{"repo":"statehub/core","pat":"enc:v1:<base64(iv+tag+ciphertext)>"}
```

Non-secret fields (`repo`, `base_url`) stay plaintext so the UI can
display them without decryption.

### GET responses

GET responses **never** return the PAT — encrypted or not. The mapper
masks it as `"pat":"••••"`:

```json
{"repo":"statehub/core","pat":"••••"}
```

The fetch route bypasses the mapper and uses
`integrationService.getDecryptedConfig()` to recover the plaintext PAT
server-side for the provider API call.

### Migration

Existing integrations created before P07D may still have plaintext
PATs in `config_json`. These remain readable by the fetch route
(legacy fallback — `decryptSecret` passes through non-`enc:v1:`
values). They are **not** auto-encrypted. To encrypt, PATCH the
integration with a fresh PAT — the new value will be stored encrypted.

### Other guarantees

- The PAT is never logged.
- Event payloads strip `pat` entirely (not even the ciphertext
  appears in the event log).
- The encryption key never leaves the server.

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

## Incremental sync (P07E)

Re-fetch is incremental: the fetch route passes `since=<last_fetch_at>`
to GitHub's `?since=` filter, so only issues updated after the
previous successful fetch are returned. The first fetch is full.

`integrations.last_used_at` tracks the last successful fetch
timestamp. Failed fetches don't update it, so retries stay
incremental from the last success.

A 5-second safety margin is subtracted from `last_fetch_at` before
passing as `since` to absorb clock skew between our server and
GitHub's API. The margin is a constant (`5_000` ms) — easy to tune.

The fetch response includes `since_used: string | null` so the UI can
show "Incremental fetch since <date>" vs "Full fetch (first time)".
The wizard shows the next-fetch mode hint next to the Fetch button
based on the selected integration's `lastUsedAt`.

To force a full re-fetch, delete the integration and recreate it
(this clears `last_used_at`). A "reset incremental" button is a
later polish.

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
