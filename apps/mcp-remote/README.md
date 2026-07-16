# apps/mcp-remote

Remote MCP server — exposes StateHub to coding agents (OpenCode, Codex, Claude)
over the MCP **Streamable HTTP** transport, running on a Cloudflare Worker.

> Status: **P02A landed.** Read + run-lifecycle tools are live; write tools
> (`upsert_work_items`, `upsert_todos`, `update_todo_status`) + dry-run land in
> P02B; UI + setup docs land in P02C.
>
> Source: `agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md`

## Transport & auth

- Single endpoint: `POST /mcp` (stateless — no session, no SSE stream).
- Auth: `Authorization: Bearer <personal-token>` on every request, including the
  MCP `initialize` handshake. A missing/invalid token is rejected with `401`
  before any JSON-RPC body is parsed.
- The Worker shares the **same D1 database** as the web app (one D1, two
  entrypoints). It builds its `DbClient` via `createD1Client(env.DB)` and never
  imports the Node-only `better-sqlite3` path.

## Tools (P02A)

| Tool | Scope | Description |
|---|---|---|
| `get_current_focus` | `read` | Active project + current feature + current-focus work item + open todos. |
| `get_feature_context` | `read` | Feature goal, todos, recent agent runs, linked evidence. |
| `start_agent_run` | `write_agent_state` | Record an agent run starting. Returns `{ run_id, status: "running" }`. Idempotent on `idempotency_key`. |
| `complete_agent_run` | `write_agent_state` | Complete a running run + record an evidence row (trust `working_tree`). Returns `{ run_id, status: "completed" }`. Idempotent. |

All tool responses use the canonical envelope: `{ ok, data, ... }` /
`{ ok:false, error_code, message, retryable, next_action? }`. A token without
`write_agent_state` gets `error_code: "scope_missing"` on write tools.

## Trust boundary

MCP tools call **domain services only** — they never write the DB directly. The
Worker is a thin transport + auth + idempotency layer over `@statehub/domain`.

## Develop

```bash
pnpm --filter @statehub/mcp-remote dev       # wrangler dev (local D1 via Miniflare)
pnpm --filter @statehub/mcp-remote build     # wrangler deploy --dry-run (bundle check)
pnpm test:mcp                                 # SDK-client integration over in-memory transport
```

## D1 binding

`wrangler.toml` binds `DB` → the `statehub-local` D1 database with migrations in
`../../packages/db/migrations`. Apply them with
`pnpm db:migrate` (from repo root) before first run.
