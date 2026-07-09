import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for StateHub.
 *
 * Targets Cloudflare D1 (SQLite dialect). Local dev uses wrangler local D1
 * (Miniflare-backed) — no `wrangler login` required for `--local` commands.
 *
 * Migrations are SQL files in ./migrations, applied via wrangler:
 *   pnpm db:migrate
 *
 * Generate new migrations from schema changes:
 *   pnpm db:generate
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  verbose: true,
  strict: true,
});
