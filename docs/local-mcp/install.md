# Installing the StateHub local sidecar

The StateHub local sidecar is a Node stdio MCP server that reads git context
from your repo and syncs evidence to Remote StateHub. It runs alongside your
coding agent (OpenCode, Codex, Claude Code) and exposes six MCP tools.

This guide covers first-run setup. For agent-specific wiring, see
[opencode-setup.md](./opencode-setup.md) or [codex-setup.md](./codex-setup.md).
For the trust model, see [trust-model.md](./trust-model.md).

## Prerequisites

- Node 22+
- pnpm 10+
- A StateHub workspace + project (run `pnpm db:seed` for the demo workspace)
- A Remote StateHub server running (default: `http://localhost:3000`)

## 1. Issue a personal token

In the StateHub web UI: **Sidebar → Settings → Tokens → New token**.

Pick scopes:
- `read` — so the sidecar can resolve workspace + project slugs at startup.
- `write_agent_state` — so it can call `sync_evidence`,
  `start_agent_run_local`, `complete_agent_run_local`.

Copy the token immediately. You won't see it again.

## 2. Add the config file

Create `.statehub/config.json` at the root of your repo:

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

This file is gitignored by the `apps/mcp-local/.gitignore` template — copy
that to your repo's `.gitignore` if you don't already ignore it.

> **The token NEVER goes in the config file.** Only the NAME of the env var
> that holds it. The sidecar reads `process.env[config.tokenEnv]` at request
> time, so a long-running sidecar picks up rotated tokens without a restart.

The `remoteUrl` is the StateHub server. `workspaceSlug` and `projectSlug`
identify which project this repo belongs to. `repoAliases` is a supplemental
list of remote URLs that should match this repo (e.g. a fork URL).

The web UI also has a setup page at
`/workspaces/:wid/settings/local-mcp` that generates the config template
prefilled with your workspace slug + selectable project.

## 3. Set the env var

```bash
export STATEHUB_TOKEN=sth_your_token_here
```

Add this to your shell profile (`~/.zshrc`, `~/.bashrc`) so it persists.

## 4. Run the sidecar

```bash
pnpm --filter @statehub/mcp-local dev
```

This starts the stdio MCP server. It will:
1. Read `.statehub/config.json` from `process.cwd()`.
2. Resolve `workspaceSlug` → `workspaceId` and `projectSlug` → `projectId`
   against `remoteUrl`.
3. Fetch the project's `repoUrl` + aliases for client-side match computation.
4. Serve the six tools over stdio until the process exits.

All logs go to stderr (stdout is the MCP channel).

## 5. Wire it into your agent

See [opencode-setup.md](./opencode-setup.md) or [codex-setup.md](./codex-setup.md).

## Verifying it works

From your repo root:

```bash
pnpm --filter @statehub/mcp-local dev
```

The startup line should say:

```
[mcp-local] serving 6 tools for personal/kavis (remote: http://localhost:3000)
```

If you see `failed to resolve project`, check:
- The StateHub server is running at `remoteUrl`.
- The workspace slug + project slug in the config match a real project.
- The token has `read` scope.

## Default-don't-leak

`collect_git_evidence` returns file lists + diff stat, NEVER full diff text.
Pass `include_diff: true` to opt in to a 64KB-truncated diff. The diff does
not leave the local process unless the agent then calls `sync_evidence` with
it in `payload_json`.

`sync_evidence` only sends file lists + diff stat in `payload_json.git_context`,
never diff content.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `config error: config.file: could not read …/config.json` | No `.statehub/config.json` in cwd | Create it (see §2) |
| `config error: config.tokenEnv: …` | `tokenEnv` is missing or lowercase | Use an uppercase env var name |
| `failed to resolve project: no workspace with slug "…"` | Wrong slug, or server down | Check config + that the server is running |
| `failed to resolve project: network error` | Server unreachable, or token invalid | Check `remoteUrl` + `STATEHUB_TOKEN` |
| `[mcp-local] config error: config.remoteUrl: must be http or https` | Missing or malformed `remoteUrl` | Use a full http(s) URL |
