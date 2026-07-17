# External links

Phase 06A introduces `external_links` — a polymorphic tie between a
StateHub entity and an external resource (PR URL, issue URL, etc.).

## Why

StateHub is the source of truth for *state*, but the work itself happens
elsewhere — in a GitHub PR, a Linear issue, a Plane ticket. An external
link is the two-way pointer: "this feature is implemented by PR #42" and
"this evidence came from issue #99".

The link is *just* a pointer — StateHub does not sync state from the
external resource in P06A. Imports (P06B/P06C) will write links as part
of ingestion; the link row remains the canonical tie point.

## Data model

```sql
CREATE TABLE external_links (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  project_id      TEXT,                       -- optional, for project-scoped links
  entity_type     TEXT NOT NULL,              -- project|feature|work_item|review_finding|evidence|decision
  entity_id       TEXT NOT NULL,
  external_source TEXT NOT NULL,              -- github_pr|github_issue|plane|linear|manual
  external_id     TEXT NOT NULL,              -- the remote id (e.g. "42")
  external_url    TEXT NOT NULL,              -- full URL
  sync_status     TEXT NOT NULL DEFAULT 'linked',  -- linked|syncing|conflict|stale
  last_synced_at  INTEGER,
  created_at      INTEGER NOT NULL,
  created_by      TEXT
);

CREATE UNIQUE INDEX idx_external_links_unique
  ON external_links (workspace_id, entity_type, entity_id, external_source, external_id);
```

The UNIQUE constraint makes link creation idempotent — re-linking the
same PR returns the existing row rather than throwing.

### `entity_type` values

| Type            | Soft-delete? | Notes                                              |
| --------------- | ------------ | -------------------------------------------------- |
| `project`       | yes          | `projects.deleted_at`                              |
| `feature`       | yes          | `features.deleted_at`                              |
| `work_item`     | yes          | `work_items.deleted_at`                            |
| `review_finding`| yes          | `review_findings.deleted_at`                       |
| `evidence`      | no           | append-only                                        |
| `decision`      | no           | append-only                                        |

`ensureEntityExists` in the service picks the right WHERE clause based on
this — soft-deleted entities are treated as missing.

### `external_source` values

`github_pr`, `github_issue`, `plane`, `linear`, `manual`.

`manual` is for ad-hoc URLs that don't fit a known importer. The import
mappers (P06B/P06C) will set `github_issue` / `plane` / `linear`
explicitly.

## API

### List links

```
GET /api/workspaces/:wid/external-links?entity_type=feature&entity_id=<uuid>&project_id=<uuid>
```

All filters are optional. Returns `{ links: ExternalLink[] }`.

### Create a link

```
POST /api/workspaces/:wid/external-links
{
  "project_id": "<uuid>|null",
  "entity_type": "feature",
  "entity_id": "<uuid>",
  "external_source": "github_pr",
  "external_id": "42",
  "external_url": "https://github.com/statehub/core/pull/42"
}
```

- Idempotent: returns the existing row if `(entity_type, entity_id,
  external_source, external_id)` already matches.
- Validates `external_url` is a parseable URL.
- Validates `entity_type` is one of the known types.
- Throws `NotFoundError` if the linked entity doesn't exist (or is
  soft-deleted).
- Emits an `external_link.created` event.

### Remove a link

```
DELETE /api/workspaces/:wid/external-links/:linkId
```

- Returns `{ id, deleted: true }`.
- Idempotent in the sense that the *first* call succeeds; a second call
  throws `NotFoundError`.
- Emits an `external_link.removed` event.

## UI

Two surfaces:

1. **Integrations settings** — `/workspaces/:wid/settings/integrations`
   - Full list of all external links in the workspace
   - Form to add a new link with a free-text entity_id
   - Remove button per row

2. **Feature detail** — `/workspaces/:wid/projects/:pid/features/:fid`
   - Inline section scoped to this feature
   - Compact add form (entity is known — only source + external_id + URL)
   - Remove button per row

Sidebar → **Integrations** to reach the settings page.

## Events

| Event                    | Payload                                            |
| ------------------------ | -------------------------------------------------- |
| `external_link.created`  | `{ after: { id, entity_type, entity_id, external_source, external_id } }` |
| `external_link.removed`  | `{ before: { id, entity_type, entity_id } }`       |

These flow through the same event ledger as every other domain mutation —
the local MCP sidecar can read them to surface "I linked PR #42" in its
own state graph.

## Idempotency guarantees

- Same `(entity_type, entity_id, external_source, external_id)` → same
  row, no duplicate created.
- The pre-check in `create()` looks up by natural key *before* INSERT, so
  we don't pay a UNIQUE-violation round-trip on the common case.
- `remove()` is the one operation that's *not* idempotent — a second
  call throws `NotFoundError`. This is intentional: the caller can
  distinguish "I just deleted it" from "it was already gone".

## Future

- `sync_status` other than `linked` is reserved for P06B/P06C importers
  that need to track ongoing sync state.
- A "sync now" action will land alongside the importers — for manual
  links it's a no-op.
- Backrefs from the external system (e.g. a GitHub PR webhook updating
  StateHub) is a later phase.
