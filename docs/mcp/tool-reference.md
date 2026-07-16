# StateHub MCP Tool Reference

The StateHub remote MCP server exposes seven tools at `POST /mcp` using the
Streamable HTTP transport. Auth is Bearer: the `Authorization` header must
contain a workspace-scoped personal access token (`Bearer sth_…`).

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
| `write_agent_state`   | `start_agent_run`, `complete_agent_run`, `upsert_work_items`, `upsert_todos`, `update_todo_status` |
| `write_review`        | reserved for P03 (review ledger writes)                |

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
```

Open the web UI → Feature Detail page to see the run in the timeline, the
todos in the checklist, and the Done Gate summary.
