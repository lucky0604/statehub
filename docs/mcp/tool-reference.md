# StateHub MCP Tool Reference

The StateHub remote MCP server exposes four tools at `POST /mcp` using the
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
| `conflict`         | true      | e.g. completing a run that isn't `running`               |
| `validation_error` | false     | bad args (zod failed)                                    |
| `internal_error`   | true      | unexpected server error                                  |

## Scopes

| Scope                 | Tools                                                  |
|-----------------------|--------------------------------------------------------|
| `read`                | `get_current_focus`, `get_feature_context`             |
| `write_agent_state`   | `start_agent_run`, `complete_agent_run`                |
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

## Typical session sequence

```
get_current_focus           → pick a feature to work on
get_feature_context         → load todos + recent runs
start_agent_run             → get a run_id
  … do the work in the repo …
complete_agent_run          → record summary + files + commands + tests
```

Open the web UI → Feature Detail page to see the run in the timeline with the
Done Gate summary.
