# packages/db

Drizzle ORM schema + Cloudflare D1 migrations for StateHub.

## Local D1 workflow

No `wrangler login` required. Local D1 is Miniflare-backed.

```bash
# Generate a migration from schema changes
pnpm db:generate

# Apply migrations to local D1
pnpm db:migrate

# Inspect local D1
pnpm db:query -- --command "SELECT name FROM sqlite_master WHERE type='table'"

# Drizzle Studio (GUI for local D1)
pnpm db:studio
```

The local D1 file lives in `.wrangler/statehub-local/` (gitignored).

## Schema layout

- `src/schema/base.ts` — base columns shared by mutable tables
- `src/schema/events.ts` — append-only audit log (P00 ships this)
- `src/schema/index.ts` — barrel export for drizzle-kit

## Conventions

Source: `agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md`

- `id` is text uuid v4, generated in app
- `workspace_id` is mandatory on workspace-scoped tables
- `version` increments on every mutable update
- `deleted_at` means soft-deleted; unique indexes use it
- `events` is append-only — no version/deleted_at/updated_at
- Every mutation appends an event in the same transaction (see `src/transaction.ts`)
- Migrations are forward-only for v1
