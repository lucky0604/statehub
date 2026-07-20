# StateHub

AI-native project manager for solo builders. Turns coding agent work
into structured project state: features, work items, todos, agent
runs, reviews, evidence, decisions — plus a writable AI PM that
proposes confirmation-gated action cards.

**Status: P07E** — live API fetch for GitHub / Plane / Linear with
incremental sync, provider tokens encrypted at rest (AES-256-GCM),
Markdown export, AI PM with action cards. Solo-dev mode (no auth);
multi-user auth lands in a later phase.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind v4 + shadcn/ui patterns
- Drizzle ORM + Cloudflare D1 (local dev via better-sqlite3)
- pnpm workspaces
- Vitest + Playwright

## Quick start (local dev, ~5 minutes)

```bash
pnpm install
pnpm db:migrate                                            # local SQLite (better-sqlite3)
cp apps/web/.env.local.example .env.local                  # if it doesn't already exist
pnpm --filter @statehub/web run gen:integration-key >> apps/web/.env.local
pnpm dev                                                    # http://localhost:3000
```

Only one env var is required: `STATEHUB_INTEGRATION_KEY` (used to
encrypt provider tokens at rest). Generate it with the
`gen:integration-key` script above. AI provider keys are optional;
the AI PM degrades gracefully without them.

## What works (P07E)

- **Core domain (P03–P04)**: work items, todos, features,
  decisions, agent runs, reviews, evidence, done-gate.
- **AI PM (P05)**: ask a question, get a proposed action card;
  apply it (confirmation-gated). Supports OpenAI / Anthropic /
  Gemini / DeepSeek / GLM.
- **GitHub import (P06B + P07A)**: live fetch via PAT, idempotent
  re-import, incremental sync via `?since=<last_fetch_at>`.
- **Plane / Linear import (P06C + P07B)**: same, with
  `workspace_slug` / `team_key`.
- **Markdown export (P06A)**: dump a workspace to a git-friendly
  Markdown tree, with PR evidence links.
- **Token encryption (P07D)**: provider tokens encrypted at rest
  with AES-256-GCM; masked as `••••` in GET responses; never in
  event payloads; lazy migration from legacy plaintext.
- **Incremental sync (P07E)**: re-fetches only issues updated since
  the last successful fetch; 5-second clock-skew margin; failed
  fetches don't advance the cursor.
- **Local + remote MCP servers (P02, P04)**: Streamable HTTP
  transport; the local sidecar runs on the user's machine and
  syncs to the remote Worker.

## Deploy

See [`docs/deploying.md`](docs/deploying.md) for the full guide.
Short version:

```bash
pnpm deploy
```

Requires a Cloudflare account + D1 database. The deploy script runs
`@opennextjs/cloudflare build` then `wrangler pages deploy`. Pages
auto-provides a `*.pages.dev` HTTPS URL.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start Next.js dev server (better-sqlite3 local DB) |
| `pnpm build` | `next build` in `apps/web` + `pnpm -r build` for packages |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | Vitest unit tests |
| `pnpm test:mcp` | MCP integration tests |
| `pnpm e2e` | Playwright end-to-end tests |
| `pnpm db:generate` | Generate Drizzle migrations from schema |
| `pnpm db:migrate` | Apply migrations to local SQLite |
| `pnpm db:seed` | Seed local DB with demo data |
| `pnpm db:studio` | Drizzle Studio against local SQLite |
| `pnpm deploy` | Build + deploy `apps/web` to Cloudflare Pages |

## Layout

```
apps/
  web/                Next.js app (Cloudflare Pages deploy target)
  mcp-remote/         Remote MCP server (Cloudflare Worker, Streamable HTTP)
  mcp-local/          Local MCP sidecar (Node, runs on user's machine)
packages/
  db/                 Drizzle schema, migrations, D1 + local clients
  domain/             Domain services + crypto + mappers
  integrations/       Provider clients (GitHub, Plane, Linear) — pure I/O
  ai/                 AI PM: zod action schema, context builder, providers
  shared/             API envelope, URL state helpers, error codes
  config/             Env validation (zod schema)
```

## Iteration docs

`agent_flow/implementation/v1/iterations/<date>-pXX-slug>/plan.md`
