# GitHub Issues import

Phase 06B adds the first concrete importer: map GitHub issues to
StateHub work items via a configured GitHub integration. Built on the
`external_links` + `integrations` + `import_jobs` tables from P06A/B.

## Why

StateHub tracks the *state* of work — features, work items, evidence,
decisions. For teams that already live in GitHub issues, asking them to
re-create every issue by hand is a non-starter. The importer:

1. Pulls issues from a GitHub repo (paste-from-export in v1; live API
   fetch lands in a later iteration once we add a server-side GitHub
   client).
2. Maps each open issue to a StateHub work item in a target project + state.
3. Records an `external_link` (source=`github_issue`, external_id=issue
   number) so the original issue is a click away from the work item.
4. Writes an `import_job` row summarizing the run for audit + history.

The whole flow is **idempotent**: re-running the same import skips
issues that already have a link. You can re-import the same repo every
week and only new issues get pulled in.

## Data model

### `integrations`

Workspace-level provider config. For GitHub: a repo + an optional PAT.

```sql
CREATE TABLE integrations (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider     TEXT NOT NULL,    -- github|plane|linear|markdown
  name         TEXT NOT NULL,    -- display name (e.g. "statehub/core")
  config_json  TEXT NOT NULL,    -- { repo, pat? }
  status       TEXT NOT NULL,    -- active|disabled|error
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL,
  created_by   TEXT
);
```

PAT storage: same trust model as personal tokens — local-only solo-dev
app, plaintext in `config_json`. Events **strip** the PAT before
writing; GET responses return `pat: null` so the PAT never leaves the
server after creation.

### `import_jobs`

Per-run audit log.

```sql
CREATE TABLE import_jobs (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  project_id     TEXT,
  integration_id TEXT NOT NULL,
  provider       TEXT NOT NULL,
  status         TEXT NOT NULL,    -- created|running|completed|failed|cancelled
  summary_json   TEXT,             -- { created, skipped, errors }
  input_json     TEXT,             -- { projectId, stateId, issueCount, issueNumbers }
  result_json    TEXT,             -- { created: [...], skipped: [...], errors: [...] }
  started_at     INTEGER,
  finished_at    INTEGER,
  created_at     INTEGER NOT NULL,
  created_by     TEXT
);
```

A row is created at the start of `run()` with `status="running"`,
updated to `completed` (or `failed`) at the end with `summary_json` +
`result_json` filled in.

## Mapping rules

For each GitHub issue:

| GitHub field   | → StateHub field                  |
| -------------- | --------------------------------- |
| `number`       | `external_links.external_id` (as string) |
| `title`        | `work_items.title`                |
| `body` + `labels` + `user` | `work_items.description_markdown` (capped at 500 chars, formatted as body + `labels: x, y` + `(@user)`) |
| `state="open"` | user-picked target state          |
| `state="closed"` | (P06B v1 ignores closed issues — they aren't in the typical "import backlog" flow) |
| `milestone.title` | resolved to an existing feature by name (case-insensitive); **no auto-create** in v1 |
| `html_url`     | `external_links.external_url`     |

Work item type defaults to `issue`; priority defaults to `medium`;
source is `import`.

## Idempotency

Before creating a work item for an issue, the importer checks
`external_links` for an existing row with
`(workspace_id, entity_type="work_item", external_source="github_issue",
external_id=String(issue.number))`.

- **Found** → skip (no re-create). The issue appears in `toSkip` with
  the existing `work_item_id` it's linked to.
- **Not found** → create work item + link.

Re-running the same import is a no-op. Conflict semantics ("the issue
is linked to a different project than the one I'm importing into") land
in P06C — v1 just skips.

## API

### List integrations

```
GET /api/workspaces/:wid/integrations?provider=github
```

Returns `{ integrations: Integration[] }`.

### Create an integration

```
POST /api/workspaces/:wid/integrations
{
  "provider": "github",
  "name": "statehub/core",
  "config": { "repo": "statehub/core", "pat": "ghp_..." }
}
```

The PAT is stored in `config_json` server-side but stripped from the
emitted event payload. GET responses return the integration with
`config.pat: null`.

### Update / remove an integration

```
PATCH /api/workspaces/:wid/integrations/:iid
{ "name": "new-name", "config": { "repo": "...", "pat": "ghp_new" } }

DELETE /api/workspaces/:wid/integrations/:iid
```

### Preview an import

```
POST /api/workspaces/:wid/integrations/:iid/import/preview
{
  "project_id": "<uuid>",
  "state_id": "<uuid>",
  "issues": [GithubIssue, ...]
}
```

Returns `{ preview: { toCreate, toSkip, errors } }`. Does **not** write
to the DB — safe to call repeatedly while tweaking the issue list.

### Run an import

```
POST /api/workspaces/:wid/integrations/:iid/import/run
{
  "project_id": "<uuid>",
  "state_id": "<uuid>",
  "issues": [GithubIssue, ...]
}
```

Returns `{ job_id, result: { created, skipped, errors } }`. Writes:

- one `import_job` row (status transitions: `running` → `completed`)
- one `work_items` row per issue in `toCreate`
- one `external_links` row per created work item (source=`github_issue`,
  external_id=issue number)
- events: `import_job.started`, `import_job.completed` (or
  `import_job.failed` if any error happens at the job level)

### List / get import jobs

```
GET /api/workspaces/:wid/import-jobs?integration_id=<uuid>&limit=20
GET /api/workspaces/:wid/import-jobs/:jobId
```

## UI

Sidebar → **Import** (icon: GitHub-style PR arrow) →
`/workspaces/:wid/import`.

The wizard is a single page with three sections:

1. **Step 1 — Pick source + target**: integration picker (filtered to
   GitHub), project picker, state picker, and a textarea for the issues
   JSON. A "Load sample" button populates the textarea with two example
   issues for quick demos.
2. **Step 2 — Preview**: table of `toCreate` (with resolved feature
   name if applicable), `toSkip`, and `errors`. A "Run import" button
   executes the run.
3. **Step 3 — Result**: created work items with their new IDs, any
   errors, and the job ID.

Below the wizard: an **Import history** panel listing recent
`import_jobs` with status icon, provider, summary counts, and timestamp.

A separate **Integrations panel** lives on the integrations settings
page (`/workspaces/:wid/settings/integrations`) for creating + removing
GitHub integrations. It sits above the external-links manager from P06A.

## Events

| Event                     | Payload                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| `integration.created`     | `{ after: { id, provider, name, config } }` — PAT stripped        |
| `integration.updated`     | `{ before, after }` — PAT stripped from both                      |
| `integration.removed`     | `{ before: { id, provider, name, config } }` — PAT stripped       |
| `import_job.started`      | `{ after: { id, integrationId, provider, issueCount } }`          |
| `import_job.completed`    | `{ after: { id, status, summary: { created, skipped, errors } } }` |
| `import_job.failed`       | `{ after: { id, status, summary } }`                              |

## Validation

The importer validates the target up front (before doing any work) so
we don't half-import then fail:

- `project_id` exists + belongs to the workspace + isn't soft-deleted
  → else `NotFoundError`
- `state_id` exists + belongs to the target project
  → else `NotFoundError` / `ValidationError`

Per-issue validation surfaces in `errors` rather than throwing:

- missing `title` → `{ issueNumber, message: "issue has no title" }`
- missing `html_url` → `{ issueNumber, message: "issue has no html_url" }`

A job with per-issue errors still transitions to `completed` — the
errors are recorded in `result_json.errors` and counted in
`summary_json.errors`. A job-level failure (e.g. target project
missing) throws before the job row is created, so no `import_job` row
is written in that case.

## Future

- **Live GitHub API fetch** — server-side GitHub client that pulls
  issues directly. v1 requires paste-from-export to keep the importer
  pure and testable without network.
- **Closed-issue import** — v1 ignores closed issues; a later flag
  (`include_closed`) could map them to the Done state.
- **Conflict resolution** — P06C adds strategies beyond "skip if
  already linked" (e.g. "re-link to new project" or "merge into
  existing work item").
- **Plane + Linear importers** — P06C adds the same shape for those
  providers, sharing the `import_jobs` table + UI wizard.
- **Webhook backrefs** — a GitHub webhook that updates StateHub when an
  imported issue closes is a later phase.
