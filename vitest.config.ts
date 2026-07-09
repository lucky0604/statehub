import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "packages/**/*.spec.ts", "apps/**/*.test.ts", "apps/**/*.spec.ts"],
    exclude: [
      "node_modules/**",
      "**/node_modules/**",
      "dist/**",
      "build/**",
      ".next/**",
      ".wrangler/**",
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
