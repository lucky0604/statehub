# OpenCode + StateHub local sidecar

Wire the StateHub local MCP sidecar into [OpenCode](https://github.com/sst/opencode)
so your coding agent can read git context and sync evidence to Remote StateHub.

## Prerequisites

Complete [install.md](./install.md) first. You should have:
- `.statehub/config.json` at your repo root.
- `STATEHUB_TOKEN` exported in your shell.

## Setup

OpenCode reads MCP server config from `opencode.json` (usually at your repo
root or `~/.config/opencode/opencode.json`).

Add the `statehub-local` server:

```json
{
  "mcp": {
    "statehub-local": {
      "type": "local",
      "command": ["pnpm", "--filter", "@statehub/mcp-local", "dev"],
      "environment": {
        "STATEHUB_TOKEN": "${STATEHUB_TOKEN}"
      }
    }
  }
}
```

The `${STATEHUB_TOKEN}` substitution pulls from your shell environment at
spawn time.

If you prefer to invoke the built binary directly (after `pnpm --filter
@statehub/mcp-local build`), use the bin wrapper:

```json
{
  "mcp": {
    "statehub-local": {
      "type": "local",
      "command": ["node", "/path/to/statehub/apps/mcp-local/bin.mjs"],
      "environment": { "STATEHUB_TOKEN": "${STATEHUB_TOKEN}" }
    }
  }
}
```

## Verifying

Start OpenCode in your repo. The sidecar's six tools should appear in
OpenCode's tool picker:

- `get_local_repo_context`
- `collect_git_evidence`
- `record_test_command`
- `sync_evidence`
- `start_agent_run_local`
- `complete_agent_run_local`

Ask the agent to call `get_local_repo_context` — it should return your repo's
git context + a `project_match_status` of `matched` or `alias_matched`.

## Typical session

```
agent: get_local_repo_context
  → repo_remote_url: git@github.com:owner/kavis.git
    project_match_status: matched

agent: start_agent_run_local
    agent: "opencode", run_type: "implement",
    feature_id: "feat-…", idempotency_key: "run-…-start"
  → run_id: "run-…"

  … do the work in the repo …

agent: record_test_command
    command: "pnpm test", exit_code: 0, duration_ms: 4200
  → evidence_payload: {…}

agent: sync_evidence
    evidence_type: "test_result",
    title: "pnpm test — all passing",
    feature_id: "feat-…",
    idempotency_key: "run-…-test-1"
  → evidence_id: "ev-…", trust_state: "working_tree" (or "trusted" if clean)

agent: complete_agent_run_local
    run_id: "run-…",
    summary: "Implemented feature X. Tests green.",
    idempotency_key: "run-…-complete-1"
  → run_id: "run-…", status: "completed", evidence_trust_state: "trusted"
```

See [trust-model.md](./trust-model.md) for how `trust_state` is derived.
