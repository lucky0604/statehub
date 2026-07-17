# Plane + Linear import

Phase 06C adds the second and third importers — Plane and Linear — on
top of the same `integrations` + `import_jobs` + `external_links`
foundation as the GitHub importer (P06B). After P06C, a workspace can
import issues from GitHub, Plane, **or** Linear into the same project.

## Why

GitHub-only import (P06B) proved the importer framework. P06C reuses
it for two more providers so a user doesn't have to be on GitHub to
pull their backlog into StateHub. The hard part — idempotency,
preview-first flow, import_job audit log, external_link tie-back — is
already done; P06C is mostly per-provider field mapping.

## What's shared with GitHub import

- **`integrations` table** — workspace-level provider config. The
  `provider` enum already included `plane` + `linear` (added in P06B's
  migration). P06C just uses them.
- **`import_jobs` table** — one row per run, with `provider` field
  distinguishing who ran. No schema change.
- **`external_links` table** — each imported issue gets a row tying
  the new work item to the external issue URL. `external_source` is
  `plane` or `linear`; `external_id` is the provider's UUID.
- **Idempotency** — same "skip if already linked" rule, keyed on
  `(workspace, work_item, external_source, external_id)`.
- **Conflict semantics** — v1 skips on conflict. The `sync_conflicts`
  table from the phase plan is still deferred.
- **API routes** — the same two routes dispatch by provider
  (see §Dispatch below). No new routes.

## Mapping

### Plane → StateHub

| Plane                | StateHub                                       |
| -------------------- | ---------------------------------------------- |
| `id` (UUID)          | `external_links.external_id`                   |
| `name` (ABC-123)     | `work_items.title`                             |
| `description`        | `work_items.description_markdown` (≤500 chars) |
| `state`              | user-picked target state (name match is best-effort) |
| `priority`           | urgent→urgent, high→high, medium/none→medium, low→low |
| `labels`             | appended to description as `labels: x, y`      |
| `assignees`          | appended to description as `(assigned: @x, @y)` |
| `project`            | resolved to an existing feature by name (case-insensitive); no auto-create |
| `link`               | `external_links.external_url`                  |
| `cycle`              | ignored in v1                                  |

### Linear → StateHub

| Linear               | StateHub                                       |
| -------------------- | ---------------------------------------------- |
| `id` (UUID)          | `external_links.external_id`                   |
| `identifier` (ABC-123) + `title` | `work_items.title` = `${identifier}: ${title}` |
| `description`        | `work_items.description_markdown` (≤500 chars) |
| `state.name`         | user-picked target state                       |
| `priority` (0-4)     | 0→urgent, 1→high, 2/4→medium, 3→low            |
| `team`               | ignored in v1 (team is a project-group hint)   |
| `project.name`       | resolved to an existing feature by name (treat Linear "project" as a StateHub feature) |
| `labels.nodes[].name`| appended to description as `labels: x, y`      |
| `assignee.name`      | appended to description as `(assigned: @name)` |
| `url`                | `external_links.external_url`                  |
| `cycle`              | ignored in v1                                  |

### Idempotency key

Plane and Linear both use UUIDs for issue ids. We key `external_links`
on the UUID — so renaming an issue in the provider and re-importing
still skips it correctly. `external_source` is part of the unique key,
so a Plane UUID and a Linear UUID can't collide.

## Dispatch by provider

The two import routes are provider-agnostic — they look up the
integration, read its `provider` field, and dispatch:

```
POST /api/workspaces/:wid/integrations/:iid/import/preview
POST /api/workspaces/:wid/integrations/:iid/import/run
```

```typescript
const integration = await integrationService.get(db, wid, iid);
const importer =
  integration.provider === "github" ? githubIssuesImporter :
  integration.provider === "plane"  ? planeIssuesImporter  :
  integration.provider === "linear" ? linearIssuesImporter : null;
```

The body is `{ project_id, state_id, issues: any[] }` — the issue
shape depends on the provider. The server casts internally; the UI's
"Load sample" button is the guardrail that fills the right shape.

## Integration config validation

`integrationService.create` validates the provider-specific config key:

| Provider | Required config key |
| -------- | ------------------- |
| github   | `config.repo` (`owner/name`) |
| plane    | `config.workspace_slug` |
| linear   | `config.team_key` |
| markdown | (none — export-only) |

PAT / API key storage is the same trust model as P06B: plaintext in
`config_json`, stripped from event payloads, returned as `null` in GET
responses.

## UI

The import wizard (`/workspaces/:wid/import`) lists every
import-capable integration (github, plane, linear — markdown is
excluded). The integration picker shows `name (provider)`. The "Load
sample" button fills provider-specific sample JSON based on the
selected integration's provider, so a user immediately sees the right
shape.

The integrations settings page (`/workspaces/:wid/settings/integrations`)
lists all integrations regardless of provider. The create form is
GitHub-focused in v1 (repo + PAT); Plane/Linear integrations are
created via seed or API. A provider-aware form is a later polish.

## Events

No new event types. Reuse `import_job.started` / `completed` / `failed`
from P06B. The `provider` field in the `import_jobs` row (and in the
`import_job.started` payload) identifies who ran.

## Future

- **Live API fetch** — server-side Plane/Linear clients that pull
  issues directly. v1 requires paste-from-export.
- **Provider-aware create form** — the integrations panel form only
  creates GitHub integrations in v1; Plane/Linear come from seed/API.
- **Shape validator** — sniff the pasted JSON and warn if it doesn't
  match the selected provider's shape (before preview).
- **Comment / relation / cycle import** — v1 maps issues only.
- **`sync_conflicts` table + conflict UI** — real conflict resolution
  beyond "skip if already linked".
