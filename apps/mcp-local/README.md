# @statehub/mcp-local

Local MCP sidecar for StateHub. A Node stdio MCP server that reads git context
from the local repo and syncs evidence to Remote StateHub.

Phase 04B. See
`agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md`.

## What it does

Six tools exposed over stdio MCP:

| Tool | Scope | Description |
| --- | --- | --- |
| `get_local_repo_context` | read | Return the current repo's git context + `project_match_status`. |
| `collect_git_evidence` | read | Gather changed files, diff stat, latest commit. Default-don't-leak: no diff text. |
| `record_test_command` | local | Record a test/lint/build command execution. Returns a payload to feed to `sync_evidence`. |
| `sync_evidence` | write | Upload evidence (test result, commit, file change, command, agent run) to Remote StateHub with git context attached. Idempotent. |
| `start_agent_run_local` | write | Record that a coding agent is starting a run, with git context auto-attached. Delegates to the remote `start_agent_run_local` MCP tool. |
| `complete_agent_run_local` | write | Complete a running agent run with git context. Returns `evidence_trust_state`. Delegates to the remote tool. |

Trust derivation happens server-side when evidence is ingested:

```
matched + clean  → trusted
matched + dirty  → working_tree
alias_matched    → same as matched
unknown          → untrusted (sync_evidence) / working_tree (agent_run_local)
```

## Setup

### 1. Create a personal token

In Remote StateHub: **Settings → Tokens → New token**. Pick scopes:
- `read` — to resolve workspace + project slugs at startup.
- `write_agent_state` — to call `sync_evidence`, `start_agent_run_local`, `complete_agent_run_local`.

Copy the token. You won't see it again.

### 2. Add the config file

Create `.statehub/config.json` in your repo (this is gitignored by default):

```json
{
  "remoteUrl": "http://localhost:3000",
  "workspaceSlug": "personal",
  "projectSlug": "kavis",
  "tokenEnv": "STATEHUB_TOKEN",
  "repoAliases": [
    "git@github.com:owner/kavis.git",
    "https://github.com/owner/kavis"
  ]
}
```

See `.statehub/config.example.json` for a template.

> **The token NEVER goes in the config file.** Only the NAME of the env var
> that holds it. The sidecar reads `process.env[config.tokenEnv]` at request
> time so a long-running sidecar picks up rotated tokens without a restart.

### 3. Set the env var

```bash
export STATEHUB_TOKEN=<your-token>
```

Add this to your shell profile (`~/.zshrc`, `~/.bashrc`) so it persists.

### 4. Run the sidecar

```bash
pnpm --filter @statehub/mcp-local dev
```

This starts the stdio MCP server. It will resolve the workspace + project
slugs against `remoteUrl` once at startup, then serve the six tools.

## Wiring into agents

### OpenCode

In your `opencode.json`:

```json
{
  "mcp": {
    "statehub-local": {
      "type": "local",
      "command": ["pnpm", "--filter", "@statehub/mcp-local", "dev"],
      "environment": { "STATEHUB_TOKEN": "${STATEHUB_TOKEN}" }
    }
  }
}
```

### Codex

In your `codex.json`:

```json
{
  "mcp_servers": {
    "statehub-local": {
      "command": "pnpm",
      "args": ["--filter", "@statehub/mcp-local", "dev"],
      "env": { "STATEHUB_TOKEN": "${STATEHUB_TOKEN}" }
    }
  }
}
```

### Claude Code

In `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "statehub-local": {
      "command": "node",
      "args": ["/path/to/statehub/apps/mcp-local/dist/index.js"],
      "env": { "STATEHUB_TOKEN": "${STATEHUB_TOKEN}" }
    }
  }
}
```

## Default-don't-leak

`collect_git_evidence` returns file lists + diff stat, NEVER full diff text.
Pass `include_diff: true` to opt in to a 64KB-truncated diff. The diff does
not leave the local process unless the agent then calls `sync_evidence` with
it in `payload_json`.

`sync_evidence` only sends file lists + diff stat in `payload_json.git_context`,
never diff content.

## Security notes

- The Bearer token is read from `process.env[config.tokenEnv]` at request time
  and is NEVER logged. `remote-client.ts` redacts `Authorization: Bearer ...`
  from any error message before throwing.
- The `Idempotency-Key` header is required on `sync_evidence` and the two
  agent_run tools. Replaying with the same key returns the first response
  verbatim, with no duplicate write.
- The sidecar resolves `workspaceSlug`/`projectSlug` to ids once at startup
  and caches them for the process lifetime. If you rename the workspace or
  project, restart the sidecar.

## Development

```bash
pnpm --filter @statehub/mcp-local build       # tsc to dist/
pnpm --filter @statehub/mcp-local typecheck   # tsc --noEmit
pnpm --filter @statehub/mcp-local test        # vitest run
```
