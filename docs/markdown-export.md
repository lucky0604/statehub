# Markdown export

Phase 06A introduces a deterministic markdown export of workspace state —
a single document you can share with reviewers, archive, or paste into an
external tool.

## Why

StateHub stores state in SQLite, but review often happens out-of-band: in a
PR description, an email, or a chat. The markdown export is the bridge —
the same data the in-app UI shows, rendered as plain markdown.

## Output structure

```
# <project name> (<identifier>)
> portfolio_priority: P0 · status: active
> exported: <iso timestamp>

## Current Focus
## Features
## Open Work Items
## Review Findings
## Agent Runs
## Evidence
## Decisions
## Weekly Reviews
```

For a single-project export, that block is the whole output. For a
workspace-wide export (no `project_id`), each project is rendered in turn,
separated by a `---` divider.

### Determinism

Section *bodies* are stable for a given DB state — no timestamps inside
sections, no random ordering. Only the header `exported:` line changes per
invocation. That makes diffs reviewable and the output safe to commit
alongside code.

## API

```
GET /api/workspaces/:wid/export/markdown
```

Query params:

| Param             | Default | Effect                                              |
| ----------------- | ------- | --------------------------------------------------- |
| `project_id`      | (omit)  | If set, export only that project. Otherwise all.   |
| `include_reviews` | `1`     | `0` hides the "Review Findings" section.            |
| `include_evidence`| `1`     | `0` hides the "Evidence" section.                   |

Response:

```json
{
  "ok": true,
  "data": {
    "markdown": "# StateHub Core (STH)\n...",
    "generated_at": 1721289600000,
    "byte_length": 4523,
    "project_ids": ["proj-uuid-1"]
  }
}
```

## UI

Sidebar → **Export** (`/workspaces/:wid/export`).

- Pick a project (or "All projects")
- Toggle Reviews / Evidence
- Click **Generate**
- **Copy** to clipboard or **Download** as `<identifier>-<date>.md`

The preview pane shows the live markdown so you can read it before
exporting.

## What's included per section

| Section            | Source                                                        |
| ------------------ | ------------------------------------------------------------- |
| Current Focus      | Latest `decision` with `source=user` on the project           |
| Features           | All features (any status)                                     |
| Open Work Items    | Work items excluding `completed` / `cancelled` status groups  |
| Review Findings    | Latest 50 reviews × their findings, sorted by severity        |
| Agent Runs         | Latest 50 agent runs                                          |
| Evidence           | All evidence across features (with their external links)      |
| Decisions          | All decisions on the project                                  |
| Weekly Reviews     | All saved weekly reviews, parsed summary JSON                 |

External links are inlined under the work item they're tied to and under
the evidence they're tied to.

## Implementation notes

- Source: `packages/domain/src/services/markdown-exporter.ts`
- The exporter walks the same domain services the UI uses — no separate
  SQL. That keeps the export honest about what the app shows.
- `exportProject(db, workspaceId, options?)` returns
  `{ markdown, generatedAt, byteLength, projectIds }`.
- Byte length is `markdown.length` (JS string length, not UTF-8 byte
  count — close enough for the UI indicator).

## Future

- P06B / P06C imports will reuse the export format as the *preview* for
  imported entities — "here's what your Plane backlog looks like as
  StateHub markdown before you commit to importing it."
- A "diff" mode comparing two exports is a likely follow-up.
