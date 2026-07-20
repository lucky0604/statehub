import type { NextConfig } from "next";

/**
 * StateHub Next.js config.
 *
 * P08A: deploy target is Cloudflare Pages via @opennextjs/cloudflare.
 * The adapter's Worker build is invoked by `pnpm --filter @statehub/web
 * deploy` (see apps/web/package.json `deploy` script); `next build`
 * itself stays unchanged.
 *
 * - `serverExternalPackages: ["better-sqlite3"]` — better-sqlite3 is a
 *   native binding, only used by the local dev DB path. Kept out of
 *   the webpack bundle so Node loads it via require() at runtime.
 *   OpenNext's Worker build tree-shakes the local path entirely;
 *   production uses D1 via `getCloudflareContext()` in
 *   `src/lib/server.ts`.
 * - Local dev (`next dev`) keeps using better-sqlite3 — we deliberately
 *   do NOT call `initOpenNextCloudflareForDev()` here, so dev doesn't
 *   depend on miniflare. Production deploys use real D1.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@statehub/db", "@statehub/shared", "@statehub/config", "@statehub/domain"],
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Allow importing workspace packages that ship .ts source.
    externalDir: true,
  },
};

export default nextConfig;
