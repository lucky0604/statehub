# StateHub MCP Tool Reference

The StateHub remote MCP server exposes eleven tools at `POST /mcp` using the
Streamable HTTP transport. Auth is Bearer: the `Authorization` header must
contain a workspace-scoped personal access token (`Bearer sth_…`).

A separate **local sidecar** (`@statehub/mcp-local`) exposes six more tools
over stdio MCP for agents that want git context auto-attached. The local
tools are documented in §10–§15 below; they delegate to the remote tools for
state-mutating calls.

Every tool returns the standard envelope:

```json
// success
{ "ok": true, "data": { … } }
// failure
{ "ok": false, "error_code": "…", "message": "…", "retryable": true }
```

Common error codes:

| code               | retryable | cause                                                    |
|--------------------|-----------|----------------------------------------------------------|
| `unauthenticated`  | false     | missing/invalid/revoked token                            |
| `scope_missing`    | false     | token lacks the scope required by the tool               |
| `not_found`        | false     | project / feature / run ID not in the token's workspace  |
| `conflict`         | true      | e.g. completing a run that isn't `running`; reopening a done todo; `expected_version` mismatch |
| `validation_error` | false     | bad args (zod failed); missing `evidence_summary` for evidence_required done |
| `idempotency_conflict` | false | `idempotency_key` reused with different args             |
| `internal_error`   | true      | unexpected server error                                  |

## Scopes

| Scope                 | Tools                                                  |
|-----------------------|--------------------------------------------------------|
| `read`                | `get_current_focus`, `get_feature_context`             |
| `write_agent_state`   | `start_agent_run`, `complete_agent_run`, `upsert_work_items`, `upsert_todos`, `update_todo_status`, `submit_review`, `create_followup_todos_from_review`, `start_agent_run_local`, `complete_agent_run_local` |
| `write_review`        | reserved for human-in-the-loop review writes (web UI only in P03) |

Token scopes are **immutable** after issuance. To change scopes, revoke and
re-issue.

---

## 1. `get_current_focus`

> What should I work on right now?

**Scope:** `read`

**Args:**

| name          | type   | required | notes                                              |
|---------------|--------|----------|----------------------------------------------------|
| `project_id`  | string | no       | Focus on a specific project. Defaults to the highest-priority active project. |

**Returns:**

```json
{
  "project": { "id": "prj_…", "name": "Atlas", "slug": "atlas" },
  "feature": { "id": "ftr_…", "name": "Auth retry", "goal": "…" },
  "goal": "…",
  "acceptance_criteria": [],
  "open_todos": [
    { "id": "tdo_…", "title": "Add backoff", "status": "open" }
  ],
  "current_focus": { "work_item_id": "wi_…", "title": "Backoff", "identifier": "ATLAS-12" }
}
```

**Notes:**
- `current_focus` is derived deterministically by `projectHealthService`.
- `acceptance_criteria` is empty in P02A; the contract shape is stable for
  forward compatibility.
- `feature` may be `null` if the project has no in-progress feature.

---

## 2. `get_feature_context`

> Load full background for a feature.

**Scope:** `read`

**Args:**

| name          | type   | required | notes                          |
|---------------|--------|----------|--------------------------------|
| `feature_id`  | string | yes      | The feature to load context for. |

**Returns:**

```json
{
  "feature": { "id": "ftr_…", "name": "Auth retry", "status": "in_progress", "goal": "…" },
  "goal": "…",
  "acceptance_criteria": [],
  "todos": [
    { "id": "tdo_…", "title": "Add backoff", "status": "open", "type": "test" }
  ],
  "recent_agent_runs": [
    { "id": "rn_…", "agent": "opencode", "run_type": "implement", "status": "completed", "summary": "…" }
  ],
  "evidence": [
    { "id": "evd_…", "trust_state": "working_tree", "files_changed": ["src/auth.ts"] }
  ],
  "open_findings": []
}
```

**Notes:**
- `recent_agent_runs` is capped at 20, newest first.
- `open_findings` is empty in P02A — reviews land in P03.

---

## 3. `start_agent_run`

> Record that an agent is beginning a task. Returns `{ run_id, status: "running" }`.

**Scope:** `write_agent_state`

**Idempotent:** yes, on `idempotency_key`. Replaying with the same key returns
the first `run_id`.

**Args:**

| name              | type   | required | notes                                                        |
|-------------------|--------|----------|--------------------------------------------------------------|
| `project_id`      | string | yes      | Must be in the token's workspace.                            |
| `feature_id`      | string | no       | Optional feature the run targets.                            |
| `work_item_id`    | string | no       | Optional work item the run targets.                          |
| `agent`           | string | yes      | Agent name, e.g. `opencode` or `codex`.                      |
| `run_type`        | string | yes      | e.g. `implement`, `investigate`, `fix`.                      |
| `model`           | string | no       | Model identifier, e.g. `glm-5.2`.                            |
| `idempotency_key` | string | yes      | Client-generated; replaying with the same key returns the first `run_id`. |

**Returns:**

```json
{ "run_id": "rn_…", "status": "running" }
```

**Errors:**
- `not_found` — project / feature / work item not in the token's workspace.
- `conflict` — a run with this `idempotency_key` already exists with different
  args (replays with identical args return the original `run_id`).

---

## 4. `complete_agent_run`

> Record that an agent finished, with evidence. Returns `{ run_id, status: "completed" }`.

**Scope:** `write_agent_state`

**Idempotent:** yes, on `idempotency_key`.

**Side effect:** creates an `evidence` row with `trust_state = "working_tree"`
in the same transaction. (Trust elevation to `trusted` via git verification
lands in Phase 04.)

**Args:**

| name              | type       | required | notes                                                         |
|-------------------|------------|----------|---------------------------------------------------------------|
| `run_id`          | string     | yes      | The running agent run to complete.                            |
| `summary`         | string     | yes      | Human-readable summary of what the agent did.                 |
| `files_changed`   | string[]   | no       | Paths of files changed by the run.                            |
| `commands_run`    | string[]   | no       | Commands executed by the agent.                               |
| `test_result`     | string     | no       | e.g. `all passing` or `2 failed`.                             |
| `risks`           | string[]   | no       | Risks the agent surfaced.                                     |
| `next_steps`      | string[]   | no       | Suggested next steps.                                         |
| `commit_sha`      | string     | no       | Optional commit SHA.                                          |
| `base_sha`        | string     | no       | Optional base SHA (for diff range).                           |
| `head_sha`        | string     | no       | Optional head SHA.                                            |
| `git_branch`      | string     | no       | Optional branch name.                                         |
| `idempotency_key` | string     | yes      | Client-generated; replaying returns the first result.         |

**Returns:**

```json
{ "run_id": "rn_…", "status": "completed" }
```

**Errors:**
- `not_found` — run ID not in the token's workspace.
- `conflict` — the run is not `running` (already completed, cancelled, or
  failed). Fix by starting a new run.

**Done Gate v0 interaction:** completing a run with `test_result` + at least
one `files_changed` entry is what flips the feature's Done Gate from
`no_completed_runs` / `missing_evidence` to ready. The gate is a **warning** —
it never blocks the agent. The user moves the feature to `needs_review` from
the web UI.

---

## 5. `upsert_work_items`

> Create or merge a work item by fingerprint. Use this for **scope-affecting**
> tasks (the Work Item-Backed Agent Rule, §4.0).

**Scope:** `write_agent_state`

**Idempotent:** yes, on `idempotency_key`. Replaying with the same key returns
the first result verbatim.

**Merge fingerprint:** `(workspace_id, project_id, COALESCE(parent_work_item_id, ''), lower(title))`
— a second call with the same project + parent + case-insensitive title
updates the existing row instead of creating a duplicate.

**Args:**

| name                  | type   | required | notes                                              |
|-----------------------|--------|----------|----------------------------------------------------|
| `project_id`          | string | yes      | Must be in the token's workspace.                  |
| `title`               | string | yes      | Used as the merge fingerprint (case-insensitive).  |
| `description_markdown`| string | no       | Optional markdown description.                     |
| `feature_id`          | string | no       | Optional feature to link the work item to.         |
| `parent_work_item_id` | string | no       | Optional parent work item.                         |
| `type`                | enum   | no       | `issue` \| `task` \| `bug` \| `enhancement` \| `note`. Default `task`. |
| `priority`            | enum   | no       | `urgent` \| `high` \| `medium` \| `low` \| `none`. Default `none`. |
| `state_id`            | string | no       | Optional initial state. Defaults to the project's default state. |
| `confidence`          | enum   | no       | `high` \| `medium` \| `low` \| `none`. Default `low` for agent writes. |
| `idempotency_key`     | string | yes      | Client-generated; replaying with the same key returns the first result. |
| `dry_run`             | bool   | no       | If true, return the would-be action with no DB write. |

**Returns:**

```json
{
  "work_item_id": "wi_…",
  "sequence_id": 12,
  "identifier": "ATLAS-12",
  "action": "created" | "updated" | "noop"
}
```

For a `dry_run` create, `work_item_id` is a synthetic `dry-run-<uuid>`
placeholder — callers must not persist it. For a `dry_run` hit, the real id +
`identifier` are returned so the agent can decide whether to issue the real
write.

**Errors:**
- `validation_error` — empty title.
- `not_found` — project / feature / parent / state not in the token's workspace.
- `idempotency_conflict` — `idempotency_key` reused with different args.

**Notes:**
- Agent-created work items ship at `source: 'remote_mcp'` and
  `confidence: 'low'` by default. The UI surfaces this so a human reviewer
  can elevate trust later.
- A soft-deleted work item with the same fingerprint is NOT revived — a new
  row is created with a new `sequence_id`.

---

## 6. `upsert_todos`

> Create or merge a todo (checklist subtask) by fingerprint. Use this for
> **implementation subtasks, checklists, and ephemeral execution notes** — NOT
> scope-affecting work (§4.0).

**Scope:** `write_agent_state`

**Idempotent:** yes, on `idempotency_key`.

**Merge fingerprint:** `(workspace_id, project_id, COALESCE(work_item_id, ''), COALESCE(feature_id, ''), COALESCE(agent_run_id, ''), lower(title))`.

**Args:**

| name                | type   | required | notes                                              |
|---------------------|--------|----------|----------------------------------------------------|
| `project_id`        | string | yes      | Must be in the token's workspace.                  |
| `title`             | string | yes      | Used as the merge fingerprint (case-insensitive).  |
| `description`       | string | no       | Optional description.                              |
| `feature_id`        | string | no       | Optional parent feature.                           |
| `work_item_id`      | string | no       | Optional parent work item.                         |
| `agent_run_id`      | string | no       | Optional parent agent run.                         |
| `type`              | enum   | no       | `implementation` \| `checklist` \| `verification` \| `note`. Default `implementation`. |
| `priority`          | enum   | no       | `urgent` \| `high` \| `medium` \| `low` \| `none`. Default `none`. |
| `evidence_required` | bool   | no       | If true, marking done later requires an `evidence_summary`. |
| `sort_order`        | int    | no       | Default 0.                                         |
| `idempotency_key`   | string | yes      | Client-generated; replaying returns the first result. |
| `dry_run`           | bool   | no       | If true, return the would-be action with no DB write. |

**Returns:**

```json
{
  "todo_id": "tdo_…",
  "status": "backlog",
  "action": "created" | "updated" | "noop"
}
```

New todos always start in `backlog`. Use `update_todo_status` to flip them.

**Errors:**
- `validation_error` — empty title.
- `not_found` — project / parent not in the token's workspace.
- `idempotency_conflict` — `idempotency_key` reused with different args.

---

## 7. `update_todo_status`

> Flip a todo's status. `done` on an `evidence_required` todo requires an
> `evidence_summary`.

**Scope:** `write_agent_state`

**Idempotent:** yes, on `idempotency_key`.

**Args:**

| name                | type   | required | notes                                              |
|---------------------|--------|----------|----------------------------------------------------|
| `todo_id`           | string | yes      | The todo to update.                                |
| `status`            | enum   | yes      | `backlog` \| `in_progress` \| `done` \| `cancelled`. |
| `evidence_summary`  | string | no       | Required if `todo.evidence_required=1` AND `status='done'`. |
| `agent_run_id`      | string | no       | Optional agent run to attribute the transition to. |
| `expected_version`  | int    | no       | Optional optimistic-concurrency check. If provided AND mismatched → `conflict`. Absent → skip the check. |
| `idempotency_key`   | string | yes      | Client-generated; replaying returns the first result. |
| `dry_run`           | bool   | no       | If true, return the would-be action with no DB write. |

**Returns:**

```json
{
  "todo_id": "tdo_…",
  "status": "in_progress",
  "version": 3,
  "action": "updated" | "noop"
}
```

A same-status transition (e.g. `in_progress` → `in_progress`) is a `noop`: no
event, no version bump, no row change.

**Errors:**
- `validation_error` — `done` on an `evidence_required` todo without `evidence_summary`.
- `not_found` — todo not in the token's workspace.
- `conflict` — todo is already `done` (cannot reopen); or `expected_version` mismatch.
- `idempotency_conflict` — `idempotency_key` reused with different args.

**Notes:**
- `expected_version` is shipped in P02B as a narrow contract: pass it to
  detect stale state, omit it to skip the check. The full conflict surface
  (Reload / Apply anyway / Dismiss) lands in P03.

---

## 8. `submit_review`

> Record a structured review (verdict + findings) against a feature, work item,
> or agent run. Returns `{ review_id, findings_count }`.

**Scope:** `write_agent_state`

**Idempotent:** yes, on `idempotency_key`.

**Side effects:**
- Creates one `reviews` row + N `review_findings` rows in one atomic batch.
- Emits `review.submitted` + one `finding.created` per finding.
- **Feature status automation (phase-03 §6):** if the review targets a feature,
  `verdict='needs_changes'`, and at least one open blocker/high finding is
  recorded, the feature is flipped to `needs_changes`. Idempotent — no
  `feature.status_changed` event if the feature is already `needs_changes`,
  `done`, or `reopened`.

**Args:**

| name              | type   | required | notes                                                         |
|-------------------|--------|----------|---------------------------------------------------------------|
| `project_id`      | string | yes      | Must be in the token's workspace.                             |
| `feature_id`      | string | no       | Optional feature the review targets.                          |
| `work_item_id`    | string | no       | Optional work item the review targets.                        |
| `agent_run_id`    | string | no       | Optional agent run the review targets.                        |
| `reviewer`        | string | yes      | Reviewer name, e.g. `codex` or `gpt-5`.                       |
| `model`           | string | no       | Optional model identifier.                                    |
| `verdict`         | enum   | yes      | `approved` \| `needs_changes` \| `blocked` \| `informational`. |
| `summary`         | string | no       | Optional human-readable summary.                              |
| `confidence`      | enum   | no       | `high` \| `medium` \| `low` \| `none`. Default `none`.        |
| `findings`        | array  | yes      | Array of finding objects (may be empty for `approved`).       |
| `idempotency_key` | string | yes      | Client-generated; replaying returns the first result.         |
| `dry_run`         | bool   | no       | If true, return the would-be action with no DB write.         |

**Finding object shape:**

| name          | type   | required | notes                                              |
|---------------|--------|----------|----------------------------------------------------|
| `severity`    | enum   | yes      | `blocker` \| `high` \| `medium` \| `low` \| `nit`. |
| `title`       | string | yes      | One-line summary.                                  |
| `description` | string | no       | Longer explanation.                                |
| `file_path`   | string | no       | File the finding refers to.                        |
| `line_start`  | int    | no       | Start line (1-based).                              |
| `line_end`    | int    | no       | End line (inclusive).                              |
| `suggestion`  | string | no       | Suggested fix.                                     |
| `feature_id`  | string | no       | Override the review's feature for this finding.   |
| `work_item_id`| string | no       | Override the review's work item for this finding. |

**Returns:**

```json
{
  "review_id": "rv_…",
  "findings_count": 2,
  "action": "created"
}
```

**Errors:**
- `validation_error` — empty `reviewer`, missing `verdict`, or a finding with empty `title` / missing `severity`.
- `not_found` — project / feature / work item / agent run not in the token's workspace.
- `idempotency_conflict` — `idempotency_key` reused with different args.

**Notes:**
- Reviews target a feature, work item, agent run, or project. At least one
  of `feature_id` / `work_item_id` / `agent_run_id` should be set for the
  review to be useful; a project-only review is allowed but rare.
- An `approved` verdict with zero findings is the cleanest review.
- The web UI's Review Ledger at `/workspaces/:wid/reviews` lists every
  review; the Feature Detail page groups findings by severity.

---

## 9. `create_followup_todos_from_review`

> Walk the open blocker/high findings on a review and create one `review_fix`
> work item per finding, linked back via `linked_work_item_id`. Returns the
> created + skipped lists.

**Scope:** `write_agent_state`

**Idempotent:** yes, on `idempotency_key`. Re-running on the same review
without changes is a `noop` — already-linked findings are skipped.

**Args:**

| name              | type     | required | notes                                                              |
|-------------------|----------|----------|--------------------------------------------------------------------|
| `review_id`       | string   | yes      | The review to walk.                                                |
| `severities`      | string[] | no       | Override which severities get fix items. Default `["blocker","high"]`. Rejects `low`/`nit` to prevent scope pollution (phase-03 §10 risk 2). |
| `idempotency_key` | string   | yes      | Client-generated; replaying returns the first result.              |
| `dry_run`         | bool     | no       | If true, return the would-be action with no DB write.              |

**Returns:**

```json
{
  "created_fixes": [
    { "work_item_id": "wi_…", "sequence_id": 17, "identifier": "ATLAS-17", "finding_id": "fi_…", "severity": "blocker" }
  ],
  "skipped_findings": [
    { "finding_id": "fi_…", "severity": "low", "reason": "severity_filtered" }
  ],
  "action": "created"
}
```

`skipped_findings[].reason` is one of:
- `severity_filtered` — finding severity not in the requested set.
- `already_linked` — finding already has a `linked_work_item_id`, or is in a
  terminal status (`fixed`, `dismissed`, `wontfix`).

**Errors:**
- `validation_error` — `severities` includes `low` or `nit` (would pollute
  project scope).
- `not_found` — review not in the token's workspace.
- `idempotency_conflict` — `idempotency_key` reused with different args.

**Notes:**
- The created work item's title is `[review_fix] ${finding.title}` so the
  UI can badge it. Priority is derived from severity: `blocker → urgent`,
  `high → high`, `medium → medium`.
- The finding's `linked_work_item_id` is set in the same transaction; a
  `finding.linked` event is emitted.
- The web UI shows a `review_fix` badge in the work-item list/kanban for any
  work item whose title starts with `[review_fix]`.

---

## Typical session sequence

```
get_current_focus           → pick a feature to work on
get_feature_context         → load todos + recent runs
start_agent_run             → get a run_id
  … do the work in the repo …
upsert_work_items           → record any new scope-affecting tasks
upsert_todos                → record checklist subtasks for the run
update_todo_status          → flip todos to in_progress / done as you go
complete_agent_run          → record summary + files + commands + tests
submit_review               → record a structured review (verdict + findings)
create_followup_todos_from_review → create review_fix work items for blocker/high findings
```

Open the web UI → Feature Detail page to see the run in the timeline, the
todos in the checklist, the findings grouped by severity, the Done Gate v1
checklist, and the Review Ledger at `/workspaces/:wid/reviews` for every
review in the workspace.

---

## Local sidecar tools (Phase 04)

The `@statehub/mcp-local` sidecar is a separate stdio MCP server that reads
git context from the local repo and syncs evidence to Remote StateHub. It
exposes the six tools below. See `docs/local-mcp/install.md` for setup.

The sidecar captures the workspace + project from `.statehub/config.json`
once at startup. The token is read from `process.env[config.tokenEnv]` at
request time so rotated tokens don't require a restart. Bearer tokens are
redacted from any thrown error message.

### 10. `get_local_repo_context`

Read-only. Returns the current repo's git context plus a `project_match_status`
computed client-side against the project's `repo_url` + aliases + the
config's `repoAliases`.

```json
// returns
{
  "repo_path": "/path/to/repo",
  "repo_remote_url": "git@github.com:owner/repo.git",
  "git_branch": "feat/x",
  "base_sha": "abc123…",
  "head_sha": "def456…",
  "dirty_state": false,
  "untracked_files": [],
  "project_match_status": "matched" | "alias_matched" | "unknown"
}
```

### 11. `collect_git_evidence`

Read-only. Gathers file lists + diff stat + latest commit. Default-don't-leak:
diff text is NOT returned unless `include_diff: true` (64KB max).

```json
// args
{ "include_diff": false, "include_untracked": true }
// returns
{
  "changed_files": ["README.md"],
  "untracked_files": ["new.txt"],
  "diff_stat": { "files_changed": 1, "insertions": 5, "deletions": 2 },
  "latest_commit": { "sha": "…", "author": "…", "message": "…", "timestamp": 1718000000000 },
  "dirty_state": true,
  "diff_text": null
}
```

### 12. `record_test_command`

Local-only. Records a test/lint/build command execution and returns a payload
to feed to `sync_evidence`. Does NOT sync to remote.

```json
// args
{
  "command": "pnpm test",
  "exit_code": 0,
  "duration_ms": 4200,
  "stdout_summary": "✓ 216 tests passed",
  "stderr_summary": ""
}
// returns
{ "recorded": true, "evidence_payload": { "evidence_type": "command", "command": "pnpm test", "exit_code": 0, "duration_ms": 4200, "success": true, "recorded_at": 1718000000000 } }
```

### 13. `sync_evidence`

Write. POSTs evidence + current git context to Remote StateHub. Remote derives
`trust_state` + `staleness_state` from repo identity + dirty state. Idempotent
on `idempotency_key`.

```json
// args
{
  "evidence_type": "test_result",
  "title": "pnpm test — all passing",
  "summary": "216 tests, 0 failures",
  "feature_id": "feat-…",
  "idempotency_key": "run-…-test-1"
}
// returns
{ "evidence_id": "ev-…", "trust_state": "working_tree", "staleness_state": "fresh", "match_status": "matched" }
```

### 14. `start_agent_run_local`

Write. Delegates to the remote `start_agent_run_local` MCP tool, injecting
`project_id` (from config) + git context (from `get_local_repo_context`).
Agent supplies `agent`, `run_type`, `model?`, `feature_id?`, `work_item_id?`,
`idempotency_key`.

```json
// returns
{ "run_id": "run-…", "status": "running" }
```

### 15. `complete_agent_run_local`

Write. Delegates to the remote `complete_agent_run_local` MCP tool, injecting
git context. If `commit_sha` is not supplied, the sidecar uses the local
`head_sha`. Returns the derived `evidence_trust_state`.

```json
// args
{
  "run_id": "run-…",
  "summary": "Implemented feature X. Tests green.",
  "files_changed": ["src/x.ts"],
  "commands_run": ["pnpm test"],
  "test_result": "216 passing",
  "idempotency_key": "run-…-complete-1"
}
// returns
{ "run_id": "run-…", "status": "completed", "evidence_trust_state": "trusted" }
```
