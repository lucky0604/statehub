# StateHub

AI-native project manager for solo builders. Turns coding agent work into structured project state: features, work items, todos, agent runs, reviews, evidence, decisions.

This repo is at **P00 (Foundation)**. See `agent_flow/implementation/v1/iterations/20260709-p00-foundation-bootstrap/plan.md` for scope.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind v4 + shadcn/ui patterns
- Drizzle ORM + Cloudflare D1 (local via wrangler)
- pnpm workspaces
- Vitest + Playwright

## Setup (target: under 5 minutes)

```bash
pnpm install
pnpm db:migrate    # applies to local D1 (no wrangler login needed)
pnpm dev           # http://localhost:3000
```

No environment variables required for local dev. The env schema (`packages/config`) accepts empty values locally.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Build all packages |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | Vitest unit tests |
| `pnpm e2e` | Playwright (config only at P00) |
| `pnpm db:generate` | Generate Drizzle migrations from schema |
| `pnpm db:migrate` | Apply migrations to local D1 |
| `pnpm db:studio` | Drizzle Studio against local D1 |

## Layout

```
apps/
  web/                Next.js app
  mcp-remote/         (placeholder, lands P02)
  mcp-local/          (placeholder, lands P04)
  workers/            (placeholder, lands P06)
packages/
  db/                 Drizzle schema, migrations, D1 client
  shared/             API envelope, URL state helpers, error codes
  config/             Env validation
  ui/                 (reserved for shared UI primitives)
```

## Deployment

Deferred to phase 06. P00 next.config stays deploy-neutral (no OpenNext adapter yet).

## Iteration docs

`agent_flow/implementation/v1/iterations/<date>-pXX-slug>/plan.md`
