# First-Sync Walkthrough

End-to-end: from a fresh StateHub install to a real coding agent recording a
run that shows up in the web UI with evidence and the Done Gate summary.

> Total time: ~10 minutes if you already have OpenCode or Codex CLI installed.

## Step 1 — Start StateHub

```bash
# from the repo root
pnpm install
pnpm db:migrate
pnpm db:seed        # creates workspace, project, feature, work items
pnpm dev            # Next.js app on http://localhost:3000
```

In another terminal, start the MCP Worker (it shares the same D1 database):

```bash
pnpm --filter @statehub/mcp-remote dev
```

The Worker prints a local URL — for local dev, point your agent at
`http://localhost:3000/mcp` (the Next.js app proxies `/mcp` to the Worker in
dev) or at the Worker's local URL directly.

## Step 2 — Issue a token

1. Open http://localhost:3000 in your browser.
2. Navigate to the workspace → **Settings → Tokens**
   (`/workspaces/<wid>/settings/tokens`).
3. Click **Issue token**.
4. Name it `first-sync`, select scopes `read` + `write_agent_state`.
5. Click **Issue**. A banner appears with the raw token starting with `sth_`.
6. **Copy it now** — the banner disappears on refresh and the raw token is
   never shown again.

## Step 3 — Point your agent at StateHub

### OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "statehub": {
      "type": "streamable_http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer sth_REPLACE_WITH_YOUR_TOKEN" }
    }
  }
}
```

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.statehub]
type = "streamable_http"
url = "http://localhost:3000/mcp"
auth_header = "Authorization"
auth_value = "Bearer sth_REPLACE_WITH_YOUR_TOKEN"
```

(For full instructions see `opencode-setup.md` / `codex-setup.md`.)

## Step 4 — Verify the connection

From your repo:

```bash
opencode
# or: codex
```

Ask the agent:

> Use the StateHub MCP `get_current_focus` tool. What's my current focus?

You should get back the seeded project's name, its in-progress feature, and the
list of open todos. If you see `unauthenticated`, your token is wrong or was
revoked. If you see `scope_missing`, re-issue the token with both `read` and
`write_agent_state`.

## Step 5 — Run a real coding session

Tell the agent (this is a generic prompt — adapt to your agent's syntax):

> 1. Call `get_current_focus` and tell me the current feature ID.
> 2. Call `start_agent_run` with project_id = <project id from step 4>,
>    feature_id = <feature id>, agent = "opencode", run_type = "implement",
>    and a random idempotency_key.
> 3. Make a small change to the README: add a line at the bottom with today's
>    date.
> 4. Call `complete_agent_run` with the run_id from step 2, a short summary,
>    files_changed = ["README.md"], commands_run = [], test_result = "n/a",
>    and a fresh idempotency_key.

The agent executes the calls. StateHub records:
- an `agent_runs` row with status `completed`
- an `evidence` row with `trust_state = "working_tree"` and `files_changed = ["README.md"]`

## Step 6 — See it in the UI

1. Refresh http://localhost:3000.
2. Open the workspace → **Agent Runs** page (`/workspaces/<wid>/agent-runs`).
   You should see your run grouped under the project, with a green
   "Completed" dot and the summary you wrote.
3. Click the run. The **Agent Run Detail Drawer** opens on the right with:
   - summary + agent + model
   - files changed (README.md)
   - commands run
   - test result
   - risks / next steps (empty if you didn't send any)
4. Navigate to the Feature Detail page
   (`/workspaces/<wid>/projects/<pid>/features/<fid>`).
   - The run shows up in the **Agent Run Timeline**.
   - The **Evidence Panel** shows the `working_tree` trust badge (amber,
     striped — unverified) next to `README.md`.
   - The **Done Gate v0** warning shows `missing_test_result` (you sent
     `test_result = "n/a"`, which counts as missing) and possibly
     `untrusted_evidence` (because the evidence is `working_tree`, not
     `trusted`). This is expected — phase 03 adds blocking rules; phase 04
     adds trust elevation via git verification.

## Step 7 — Move the feature forward (manual UI step)

Done Gate v0 rule 5: **feature status can only be changed from the UI, never
through MCP.** The agent cannot mark the feature as ready for review — only
the human can.

1. On the Feature Detail page, look at the **status button** in the top-right.
2. If the Done Gate says `readyForReview`, the **Mark as ready for review**
   button is highlighted.
3. Click it. The feature moves to `needs_review`.

(If the gate doesn't say `readyForReview`, the button is still available —
the gate is a warning, not a block, in v0.)

## What you've verified

- Token issuance works (UI + API).
- Bearer auth on the MCP server works.
- `get_current_focus` returns the right workspace state.
- `start_agent_run` + `complete_agent_run` create rows + evidence.
- The web UI shows runs + evidence + the Done Gate derivation.
- The TopBar MCP sync indicator flips from "MCP not configured" to "Connected".
- The right rail "Recent Agent Runs" shows your run.

You're ready to use StateHub for real work. See `tool-reference.md` for the
full tool contracts.
