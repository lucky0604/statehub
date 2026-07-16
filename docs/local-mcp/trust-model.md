# Trust model

StateHub derives a `trust_state` for every piece of evidence. The trust state
gates whether the Done Gate will let a feature move to `done`.

## States

| State           | Meaning                                                                  | Done Gate |
|-----------------|--------------------------------------------------------------------------|-----------|
| `trusted`       | Repo URL matches the project (or an alias), and the working tree is clean (no uncommitted or untracked files). | Pass |
| `working_tree`  | Repo URL matches, but the working tree is dirty. The evidence reflects uncommitted work. | Warn |
| `untrusted`     | Repo URL does not match any project in the workspace. Evidence is recorded but flagged. | Block |
| `unknown`       | Not yet assessed (default for evidence created via the non-local MCP tools). | Block |

## Derivation

The local sidecar (`@statehub/mcp-local`) sends git context with every
`sync_evidence` call. Remote StateHub's `localEvidenceService.ingest` derives
trust as follows:

```
match_status = resolveProjectByRepoUrl(repo_remote_url)
  → "matched"        if URL normalizes to the project's repo_url
  → "alias_matched"  if URL normalizes to one of the project's aliases
  → null             otherwise (unknown)

if match_status is null:
    trust_state = "untrusted"
elif dirty_state is true:
    trust_state = "working_tree"
else:
    trust_state = "trusted"
```

`complete_agent_run_local` follows the same derivation when it records the
final agent_run evidence.

### URL normalization

`normalizeRepoUrl` (in `packages/shared/src/repo-url.ts`) collapses:

- `git@github.com:owner/repo.git` → `https://github.com/owner/repo`
- `https://github.com/owner/repo.git` → `https://github.com/owner/repo`
- `ssh://git@github.com/owner/repo` → `https://github.com/owner/repo`

The host is lowercased. `.git` suffix is stripped. So you can configure the
project's `repo_url` as the HTTPS form and the sidecar will still match an
SSH remote.

## Staleness

A separate `staleness_state` is derived by comparing the evidence's
`latest_commit_ts` (if present in `payload_json.git_context`) against the
latest evidence row on the same target. If the new commit is older than the
most recent evidence, the new row is marked `stale`.

| State   | Meaning                                                        |
|---------|----------------------------------------------------------------|
| `fresh` | Newer than (or equal to) the latest existing evidence row.    |
| `stale` | Older than the latest existing evidence row.                  |
| `unknown` | No `latest_commit_ts` in payload, or first evidence on target. |

## Dirty state

`dirty_state` is `true` whenever:

- `git status --porcelain` returns any output (modified, staged, deleted, etc.), OR
- untracked files exist

`dirty_state=true` blocks `trust_state=trusted`. Commit your work and re-sync
to upgrade evidence from `working_tree` to `trusted`.

## Done Gate integration

The Done Gate v1 checklist (P03C) includes an `evidence_trusted` item that
blocks when evidence is `untrusted`/`unknown`, warns when only `working_tree`,
and passes when all evidence is `trusted`.

P04C adds a `feature_evidence_trusted` item with broader semantics:

- **Pass**: feature has ≥1 evidence with `trust_state=trusted`.
- **Warn**: feature has evidence but none `trusted` (only `working_tree`).
- **Block**: feature has zero evidence, OR all evidence is `untrusted`/`unknown`.

This item runs alongside the existing `evidence_trusted` item — both must
pass for the overall result to be `pass`.

## Visual cues in the UI

The EvidencePanel (P04C) renders chips alongside the trust + staleness badges:

- **Dirty working tree** (amber) — `payload.git_context.dirty_state === true`
- **Stale test** (amber) — `staleness_state === 'stale'`
- **Repo unknown** (neutral) — `payload.git_context.match_status === 'unknown'`

These are additive — the existing `EvidenceTrustBadge` and `StalenessBadge`
are unchanged.

## See also

- [install.md](./install.md) — first-run setup
- [opencode-setup.md](./opencode-setup.md) — OpenCode wiring
- [codex-setup.md](./codex-setup.md) — Codex wiring
- `docs/mcp/tool-reference.md` §10–§15 — local sidecar tool reference
