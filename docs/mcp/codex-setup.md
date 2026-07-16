# Codex CLI → StateHub MCP Setup

Connect [Codex CLI](https://github.com/openai/codex) to a StateHub workspace so
every coding session becomes an audited agent run with evidence + todos + a
Done Gate check.

> Prerequisite: a running StateHub instance and a workspace. If you don't have
> one yet, see `first-sync.md` for the full walkthrough.

## 1. Issue a personal access token

1. In the StateHub web UI, open **Settings → Tokens** (`/workspaces/<wid>/settings/tokens`).
2. Click **Issue token**.
3. Name it (e.g. `codex-laptop`).
4. Select the scopes you need:
   - `read` — call `get_current_focus` and `get_feature_context`
   - `write_agent_state` — call `start_agent_run` and `complete_agent_run`
   - `write_review` — reserved for P03 (review ledger writes)
5. Copy the raw token **now**. It starts with `sth_` and is shown **once**.

## 2. Configure Codex

StateHub's MCP server uses the Streamable HTTP transport at `POST /mcp`, with
Bearer auth.

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.statehub]
type = "streamable_http"
url = "http://localhost:3000/mcp"
auth_header = "Authorization"
auth_value = "Bearer sth_REPLACE_WITH_YOUR_TOKEN"
```

For a deployed instance, replace `http://localhost:3000` with your Worker URL
(e.g. `https://statehub-mcp-remote.<account>.workers.dev`).

> **One token per workspace.** A StateHub token is workspace-scoped — the
> `workspace_id` resolved from the token gates every query the agent makes.
> A token cannot reach across workspaces.

## 3. Verify the connection

From your repo:

```bash
codex
```

Inside the Codex session, ask:

> Use the StateHub MCP `get_current_focus` tool. What's my current focus?

You should see a response with the workspace's current project + work item or
feature. If you get a 401, the token is wrong or revoked. If you get a 404 on
`/mcp`, the URL is wrong.

## 4. Typical session flow

A coding session that talks to StateHub follows this loop:

1. **Start of session**: call `get_current_focus` to find the in-progress work
   item or feature.
2. **Before making changes**: call `start_agent_run` with the feature ID and a
   short `summary`. StateHub returns the new `run_id`.
3. **Do the work** in your repo.
4. **End of session**: call `complete_agent_run` with the run ID, files
   changed, commands run, test result, and (optionally) risks + next steps.
5. **Open the web UI**: the Feature Detail page now shows this run in the
   timeline with evidence (files + commands + tests) and the Done Gate v0
   summary.

See `tool-reference.md` for the exact argument shapes, and `first-sync.md`
for a complete end-to-end walkthrough with seed data.

## 5. Scope mismatch errors

If you call a `write_*` tool with a token that only has `read`, the MCP server
returns:

```json
{ "ok": false, "error_code": "scope_missing", "retryable": false }
```

Fix: revoke the read-only token and issue a new one with the needed scopes.
Token scopes are immutable after issuance (P02C).
