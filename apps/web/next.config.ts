import type { NextConfig } from "next";

/**
 * P00 keeps next.config deploy-neutral.
 * OpenNext adapter wiring deferred to phase 06.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@statehub/db", "@statehub/shared", "@statehub/config", "@statehub/domain"],
  // better-sqlite3 is a native binding — keep it out of the webpack bundle so
  // Node.js loads it via require() at runtime. We load it via
  // __non_webpack_require__ in packages/db/src/local-client.ts.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Allow importing workspace packages that ship .ts source.
    externalDir: true,
  },
};

export default nextConfig;
