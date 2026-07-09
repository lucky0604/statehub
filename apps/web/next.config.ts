import type { NextConfig } from "next";

/**
 * P00 keeps next.config deploy-neutral.
 * OpenNext adapter wiring deferred to phase 06.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@statehub/db", "@statehub/shared", "@statehub/config"],
  experimental: {
    // Allow importing workspace packages that ship .ts source.
    externalDir: true,
  },
};

export default nextConfig;
