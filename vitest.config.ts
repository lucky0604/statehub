import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@/": `${resolve(__dirname, "apps/web/src")}/`,
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "packages/**/*.spec.ts", "apps/**/*.test.ts", "apps/**/*.spec.ts"],
    exclude: [
      "node_modules/**",
      "**/node_modules/**",
      "dist/**",
      "build/**",
      ".next/**",
      "**/.next/**",
      ".open-next/**",
      "**/.open-next/**",
      ".wrangler/**",
      "**/.wrangler/**",
      "apps/web/e2e/**",
      "playwright-report/**",
      "test-results/**",
    ],
    globals: false,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.test.ts", "**/*.spec.ts", "**/*.config.*"],
    },
  },
});
