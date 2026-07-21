# Deploying StateHub

This guide walks you through deploying StateHub to Cloudflare Pages +
D1. The app is designed for this target — local dev uses
better-sqlite3, production uses D1, switched at runtime via the
NODE_ENV branch in `apps/web/src/lib/server.ts`.

**Time:** ~20 minutes for a first deploy.

## Prerequisites

- A Cloudflare account (free tier works for a solo deploy).
- Node 20+ and pnpm 10+ installed locally.
- The StateHub repo cloned and `pnpm install` already run.

## 1. Create a D1 database

```bash
cd apps/web
npx wrangler login                          # one-time, opens browser
npx wrangler d1 create statehub-local
```

The output looks like:

```
✅ Successfully created DB 'statehub-local'
[[d1_databases]]
binding = "DB"
database_name = "statehub-local"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # ← copy this
```

Paste the `database_id` into `apps/web/wrangler.toml`, replacing the
`"local"` placeholder.

## 2. Apply migrations to the remote D1

```bash
npx wrangler d1 migrations apply statehub-local --remote
```

This runs every SQL file in `packages/db/migrations/` against your
remote D1. You only need to do this once per fresh database;
subsequent deploys don't require it (but it's safe to re-run —
migrations use `IF NOT EXISTS`).

## 3. Set environment variables

In the Cloudflare dashboard:

**Workers & Pages → your project → Settings → Environment variables
(Production)**

| Variable | Required | How to generate |
|---|---|---|
| `STATEHUB_INTEGRATION_KEY` | yes | `pnpm --filter @statehub/web run gen:integration-key` (paste the base64 string) |
| `STATEHUB_AUTH_SECRET` | yes | `pnpm --filter @statehub/web run gen:auth-secret` (paste the base64 string; see "Securing the deploy" below) |
| `APP_URL` | yes | `https://<project>.pages.dev` (set after first deploy) |
| `OPENAI_API_KEY` | no | OpenAI dashboard |
| `ANTHROPIC_API_KEY` | no | Anthropic console |
| `GEMINI_API_KEY` | no | Google AI Studio |
| `DEEPSEEK_API_KEY` | no | DeepSeek platform |
| `GLM_API_KEY` | no | Zhipu AI platform |

Use **Encrypt** for `STATEHUB_INTEGRATION_KEY`, `STATEHUB_AUTH_SECRET`,
and any AI provider keys — they're secrets. `APP_URL` can be plaintext.

Or via CLI:

```bash
cd apps/web
npx wrangler secret put STATEHUB_INTEGRATION_KEY
npx wrangler secret put STATEHUB_AUTH_SECRET
# paste the base64 strings at each prompt
```

## 4. First deploy

From the repo root:

```bash
pnpm deploy:web
```

This runs:

1. `pnpm --filter @statehub/web build` (Next.js build)
2. `opennextjs-cloudflare` (bundles the Next.js build for Cloudflare
   Workers runtime)
3. `wrangler deploy` (uploads the Worker + static assets to Cloudflare)

The first deploy prints a URL like
`https://statehub-web-abc123.pages.dev`. Open it, click around, create
a work item — if it shows up in the list, D1 is wired correctly.

After the first deploy, set `APP_URL` to the `*.pages.dev` URL (or
your custom domain) and redeploy.

## 5. Redeploy

Any time you pull changes from main:

```bash
git pull
pnpm install                              # if pnpm-lock.yaml changed
pnpm deploy:web
```

For schema changes (new migrations in `packages/db/migrations/`):

```bash
npx wrangler d1 migrations apply statehub-local --remote
pnpm deploy:web
```

## Securing the deploy

StateHub ships with built-in email/password auth (P08B). Every
non-public route goes through `apps/web/middleware.ts`, which verifies
an HMAC-signed `statehub_session` cookie. Sessions are stateless —
there is no DB row to revoke; rotating `STATEHUB_AUTH_SECRET`
invalidates all outstanding sessions.

To enable auth on a fresh deploy:

1. **Generate an auth secret and set it as a Cloudflare secret:**

   ```bash
   pnpm --filter @statehub/web run gen:auth-secret
   # prints STATEHUB_AUTH_SECRET=<base64>
   cd apps/web
   npx wrangler secret put STATEHUB_AUTH_SECRET
   # paste the base64 string at the prompt
   ```

2. **Apply migrations to remote D1** (adds the `password_hash` column):

   ```bash
   npx wrangler d1 migrations apply statehub-local --remote
   ```

3. **Create your first user** — the script shells out to
   `wrangler d1 execute --remote`:

   ```bash
   pnpm --filter @statehub/web run add-user -- \
     --email=you@example.com --name=You --password='minimum-8-chars' --remote
   ```

   Re-running the same command resets the password for an existing
   user (idempotent).

4. **Deploy:**

   ```bash
   pnpm deploy:web
   ```

Visiting `https://<your-domain>/` now redirects to `/login`. Sign in
with the credentials you just created.

### Rotating the auth secret

If you need to invalidate all outstanding sessions (e.g. a suspected
cookie leak):

```bash
cd apps/web
npx wrangler secret put STATEHUB_AUTH_SECRET
# paste a freshly generated base64 string
pnpm deploy:web
```

Every user gets redirected to `/login` on their next request.

### Public routes

The following paths skip the auth check (see
`apps/web/middleware.ts`):

- `/login` — the login form
- `/api/auth/login`, `/api/auth/logout` — auth endpoints
- `/api/health` — health check

Requests with a `Bearer` Authorization header also skip cookie auth —
the local MCP sidecar uses this path (`/api/workspaces/[wid]/projects/[pid]/local-evidence`) with a workspace-scoped personal token.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `wrangler pages deploy` fails with "Not authenticated" | wrangler login missing or expired | `npx wrangler login` |
| 500 on every request, `wrangler tail` shows `D1 binding missing` | `wrangler.toml` not in `apps/web/` or `database_id` still `"local"` | paste the real database_id from `wrangler d1 create` output |
| 500 on first API call, `STATEHUB_INTEGRATION_KEY is not set` | env var not set in Cloudflare | dashboard → Settings → Environment variables; redeploy |
| `pnpm deploy` fails at `opennextjs-cloudflare` step | Next.js version mismatch with adapter | check `@opennextjs/cloudflare` supported Next range; pin if needed |
| 500 with "better-sqlite3" in the log | production code path falling back to local DB | verify `NODE_ENV=production` in Cloudflare; check `apps/web/src/lib/server.ts` branch |
| Token encryption works locally but fails in prod | `STATEHUB_INTEGRATION_KEY` differs between env and Cloudflare | re-set the same base64 string in Cloudflare; redeploy |

## Rolling back

Cloudflare Pages keeps every deploy. To roll back:

1. Dashboard → Workers & Pages → your project → Deployments.
2. Find the last known-good deploy.
3. Click "Promote to production".

Database migrations are NOT automatically rolled back — if a
migration broke something, you'll need to manually undo the SQL
change in D1.

## What about `apps/mcp-remote`?

The remote MCP server is a separate Cloudflare Worker, not a Pages
project. It has its own `wrangler.toml` and its own deploy path:

```bash
cd apps/mcp-remote
npx wrangler deploy
```

It shares the same D1 database as the web app — one D1, two
entrypoints. Both can read/write the same data concurrently.
